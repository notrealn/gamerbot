import { Message } from 'discord.js';

import { Command, CommandDocs } from '..';
import { CmdArgs } from '../../types';
import { Embed, updatePlayingEmbed } from '../../util';

export class CommandPlaying implements Command {
  cmd = ['playing', 'np'];
  docs: CommandDocs = [
    {
      usage: 'playing',
      description: 'show now playing embed',
    },
  ];
  async executor(cmdArgs: CmdArgs): Promise<void | Message> {
    const { msg, queueStore } = cmdArgs;

    const queue = queueStore.get(msg.guild?.id as string);

    if (!queue.playing) return msg.channel.send('not playing');

    await updatePlayingEmbed({ playing: false });

    queue.current.embed = await msg.channel.send(
      new Embed({ noAuthor: true, title: 'loading...' })
    );

    updatePlayingEmbed({ playing: true });
  }
}