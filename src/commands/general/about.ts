import { Message } from 'discord.js';

import { Command } from '..';
import { Context } from '../../types';
import { Embed } from '../../util';

export class CommandAbout implements Command {
  cmd = 'about';
  docs = {
    usage: 'about',
    description: 'Show about message.',
  };
  async execute(context: Context): Promise<void | Message> {
    const embed = new Embed({ title: 'about' }).setDefaultAuthor();
    embed
      .addField('wheere is source code', 'https://github.com/gamer-gang/gamerbot')
      .addField('found bug??', "report it in the repo's issues page")
      .addField('nice pfp', 'pfp made by @qqq#0447')
      .addField('a', 'b');
    return context.msg.channel.send(embed);
  }
}
