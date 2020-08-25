import { GuildEmoji, Message, MessageReaction, PartialUser, Role, User } from 'discord.js';
import emojiRegex from 'emoji-regex';
import { inspect } from 'util';

import { Command } from '.';
import { client, reactionRoleStore } from '..';
import { Embed } from '../embed';
import { CmdArgs } from '../types';

export class CommandRole implements Command {
  cmd = 'role';
  docs = {
    usage: 'role <roleId> <emoji>',
    description: 'create a role distributor given an emoji',
  };
  async executor(cmdArgs: CmdArgs): Promise<void | Message> {
    const { msg, args, client } = cmdArgs;

    console.log(msg.content);

    if (!msg.guild?.members.resolve(msg.author as User)?.hasPermission('ADMINISTRATOR'))
      return msg.channel.send('missing `ADMINISTRATOR` permission');

    if (args.length !== 2)
      return msg.channel.send(`expected 2 args\nusage: \`${this.docs.usage}\``);

    const role = msg.guild?.roles.resolve(args[0]);
    if (!role) return msg.channel.send('could not resolve role ' + args[0]);

    let emoji: GuildEmoji | string = args[1].trim();
    if (/^<:.+:\d{18}>$/.test(emoji)) {
      // custom emoji
      const customId = (emoji as string).replace(/(<:.+:|>)/g, '');
      console.log(customId);
      emoji = msg.guild.emojis.cache.find(e => e.id == customId) as GuildEmoji;
    } else {
      const exec = emojiRegex().exec(emoji);
      console.log(inspect(exec, true, null, true));
      // invalid emoji
      if (!exec || exec[0] !== emoji) return msg.channel.send('invalid emoji');
      // valid emoji, nothing to do
    }

    const embed = new Embed()
      .setTitle('role: ' + role.name)
      .setDescription(`react with ${emoji} to receive the \`${role.name}\` role!`);

    const embedMessage = await msg.channel.send(embed);
    embedMessage.react(emoji);

    msg.delete();

    // save message for restarts
    const reactions = reactionRoleStore.get(msg.guild.id);
    reactions[embedMessage.id] = { emoji: emoji.toString(), roleId: role.id };
    reactionRoleStore.set(msg.guild.id, reactions);
  }
}

const verifyReaction = async (
  reaction: MessageReaction,
  user: User | PartialUser
): Promise<boolean> => {
  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch (err) {
      console.error('Something went wrong when fetching the message: ', err);

      (await user.createDM()).send(
        new Embed()
          .setTitle('error modifying roles in ' + reaction.message.guild?.name)
          .setDescription(
            `\`\`\`\n${err}\n\`\`\`\n` +
              'please contact wiisportsresorts#9388 or a server admin for help.'
          )
      );

      return false;
    }
  }

  return true;
};

const roleError = async ({
  reaction,
  user,
  listener,
  role,
}: {
  reaction: MessageReaction;
  user: User | PartialUser;
  listener: {
    emoji: string;
    roleId: string;
  };
  role: Role | null | undefined;
}) => {
  (await user.createDM()).send(
    new Embed()
      .setTitle('error modifying roles in ' + reaction.message.guild?.name)
      .setDescription(
        `\`\`\`\nrole id of ${listener.roleId} could not be resolved\n\`\`\`\n` +
          'please contact wiisportsresorts#9388 or a server admin for help.'
      )
  );
};

export const onMessageReactionAdd = async (
  reaction: MessageReaction,
  user: User | PartialUser
): Promise<unknown> => {
  if (user.id === client.user?.id) return;
  if (!(await verifyReaction(reaction, user))) return;
  const { message: msg } = reaction;

  const listener = reactionRoleStore.get(msg.guild?.id as string)[msg.id];
  if (!listener) return;

  if (reaction.emoji.toString() === listener.emoji) {
    const role = msg.guild?.roles.resolve(listener.roleId);
    if (!role) return roleError({ reaction, user, listener, role });

    await msg.guild?.members.resolve(user.id)?.roles.add(role);
    (await user.createDM()).send(
      new Embed()
        .setTitle(`received role \`${role.name}\` in ${msg.guild?.name}!`)
        .setDescription('remove the reaction from the message to remove this role.')
    );
  }
};

export const onMessageReactionRemove = async (
  reaction: MessageReaction,
  user: User | PartialUser
): Promise<unknown> => {
  if (user.id === client.user?.id) return;
  if (!(await verifyReaction(reaction, user))) return;
  const { message: msg } = reaction;

  const listener = reactionRoleStore.get(msg.guild?.id as string)[msg.id];
  if (!listener) return;

  if (reaction.emoji.toString() === listener.emoji) {
    const role = msg.guild?.roles.resolve(listener.roleId);
    if (!role) return roleError({ reaction, user, listener, role });

    await msg.guild?.members.resolve(user.id)?.roles.remove(role);
    (await user.createDM()).send(
      new Embed()
        .setTitle(`removed role \`${role.name}\` in ${msg.guild?.name}!`)
        .setDescription('react to the message again to get the role back.')
    );
  }
};
