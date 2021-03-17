import { DMChannel, Guild, GuildChannel, TextChannel } from 'discord.js';
import _ from 'lodash';
import { LogHandlers } from '.';
import { Embed } from '../../util';
import { formatValue, getLatestAuditEvent, logColorFor } from './utils';

const auditChangeTable: Record<string, string> = {
  topic: 'Topic',
  nsfw: 'NSFW',
  rateLimitPerUser: 'Slowmode (seconds)',
  parentID: 'Category',
};

export const channelHandlers: LogHandlers = {
  onChannelCreate: (guild: Guild, logChannel: TextChannel) => async (
    channel: DMChannel | GuildChannel
  ) => {
    if (channel.type === 'dm') return;

    const auditEvent = await getLatestAuditEvent(guild);

    const embed = new Embed({
      author: {
        iconURL: guild.iconURL({ format: 'png' }) ?? undefined,
        name: guild.name,
      },
      color: logColorFor('channelCreate'),
      title: 'Channel created',
    })
      .addField('Name', channel.name)
      .addField('ID', channel.id)
      .addField('Type', channel.type)
      .setTimestamp();

    channel.parent && embed.addField('Category', channel.parent.name);

    embed.addField('Created by', auditEvent.executor);

    logChannel.send(embed);
  },
  onChannelDelete: (guild: Guild, logChannel: TextChannel) => async (
    channel: DMChannel | GuildChannel
  ) => {
    if (channel.type === 'dm') return;

    const auditEvent = await getLatestAuditEvent(guild);

    const embed = new Embed({
      author: {
        iconURL: guild.iconURL({ format: 'png' }) ?? undefined,
        name: guild.name,
      },
      color: logColorFor('channelDelete'),
      title: 'Channel deleted',
    })
      .addField('Name', channel.name)
      .addField('ID', channel.id)
      .addField('Type', channel.type)
      .setTimestamp();

    channel.parent && embed.addField('Category', channel.parent.name);

    embed.addField('Deleted by', auditEvent.executor);

    logChannel.send(embed);
  },
  onChannelUpdate: (guild: Guild, logChannel: TextChannel) => async (
    prev: DMChannel | GuildChannel,
    next: DMChannel | GuildChannel
  ) => {
    if (prev.type === 'dm' || next.type === 'dm') return;

    const auditEvent = await getLatestAuditEvent(guild);

    const embed = new Embed({
      author: {
        iconURL: guild.iconURL({ format: 'png' }) ?? undefined,
        name: guild.name,
      },
      color: logColorFor('channelUpdate'),
      title: 'Channel updated',
      description: `Updated channel: ${next.type === 'voice' ? `${next.name} (voice)` : next}, ID ${
        next.id
      }`,
    }).setTimestamp();

    const changes = _.omit(
      _.omitBy(prev, (v, k) => next[k as keyof GuildChannel] === v),
      'permissionOverwrites',
      'rawPosition',
      'lastMessageID'
    );

    if (!Object.keys(changes).length) return;

    Object.keys(changes).forEach(change => {
      if (change === 'parentID')
        return embed.addField(
          auditChangeTable[change] ?? change,
          `\`${formatValue(
            prev[change] ? guild.channels.cache.get(prev[change]!)?.name : null
          )} => ${formatValue(
            next[change] ? guild.channels.cache.get(next[change]!)?.name : null
          )}\``
        );

      embed.addField(
        auditChangeTable[change] ?? change,
        `\`${formatValue(prev[change])} => ${formatValue(next[change])}\``
      );
    });

    if (
      auditEvent.action === 'CHANNEL_UPDATE' &&
      (auditEvent.target as GuildChannel).id === next.id &&
      Math.abs(auditEvent.createdTimestamp - Date.now()) < 1500 // within 1500ms
    )
      embed.addField('Updated by', auditEvent.executor);

    logChannel.send(embed);
  },
};
