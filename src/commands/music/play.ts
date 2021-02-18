import { Message, StreamOptions, TextChannel, VoiceChannel } from 'discord.js';
import _ from 'lodash';
import miniget from 'miniget';
import moment from 'moment';
import * as mm from 'music-metadata';
import yts from 'yt-search';
import { Command, CommandDocs } from '..';
import { client, getLogger, logger } from '../../providers';
import { Context, FileTrack, SpotifyTrack, Track, YoutubeTrack } from '../../types';
import { codeBlock, Embed, regExps, toDuration } from '../../util';

export class CommandPlay implements Command {
  cmd = ['play', 'p'];
  docs: CommandDocs = [
    {
      usage: ['play <url>'],
      description: 'play youtube video from a video/playlist url; must not be private',
    },
    {
      usage: ['play <...searchString>'],
      description: 'search for a video, and choose from the top 5 results.',
    },
  ];
  async execute(context: Context): Promise<void | Message> {
    const { msg, args } = context;

    const voice = msg.member?.voice;
    if (!voice?.channel) return msg.channel.send(Embed.error('You are not in a voice channel'));

    const queue = client.queues.get(msg.guild.id);

    const permissions = voice.channel.permissionsFor(client.user?.id as string);
    if (!permissions?.has('CONNECT'))
      return msg.channel.send(Embed.error("Can't connect to channel"));
    if (!permissions?.has('SPEAK')) return msg.channel.send(Embed.error("Can't speak in channel"));

    if (!args._[0]) {
      // check for uploaded files
      if (msg.attachments.size) {
        const attachment = msg.attachments.array()[0];
        const metadata = await mm.parseStream(miniget(attachment.url));

        this.queueTrack(
          new FileTrack(msg.author?.id as string, {
            title: (attachment.name || _.last(attachment.url.split('/'))) ?? 'Unknown',
            url: attachment.url,
            duration: toDuration(metadata.format.duration),
          }),
          { context }
        );

        return;
      }

      if (queue?.voiceConnection?.dispatcher?.paused) {
        queue.voiceConnection?.dispatcher.resume();
        queue.paused = false;
        queue.updateNowPlaying();
        return msg.channel.send(Embed.success('Resumed'));
      }

      if (!queue.playing && queue.tracks.length) {
        queue.index = 0;
        return this.playNext(context);
      }

      return msg.channel.send(Embed.error('Expected at least one arg'));
    }

    msg.channel.startTyping();
    if (regExps.youtube.playlist.test(args._[0])) await this.getYoutubePlaylist(context);
    else if (regExps.youtube.video.test(args._[0])) await this.getYoutubeVideo(context);
    else if (regExps.youtube.channel.test(args._[0])) await this.getYoutubeChannel(context);
    else if (regExps.spotify.playlist.test(args._[0])) await this.getSpotifyPlaylist(context);
    else if (regExps.spotify.album.test(args._[0])) await this.getSpotifyAlbum(context);
    else if (regExps.spotify.track.test(args._[0])) await this.getSpotifyTrack(context);
    else if (regExps.url.test(args._[0])) msg.channel.send(Embed.error('Invalid URL'));
    else await this.searchYoutube(context);
    msg.channel.stopTyping(true);
  }

  private checkSpotify(msg: Message): boolean {
    if (client.spotifyDisabled) {
      msg.channel.send(
        Embed.error('Spotify support disabled', 'No credentials provided in environment')
      );
      return false;
    }

    if (!client.spotify.getAccessToken()) {
      msg.channel.send(
        Embed.error(
          'Cannot connect to spotify',
          `Please try again in ${moment
            .duration(client.spotifyTimeoutSeconds, 'seconds')
            .humanize(true)}`
        )
      );

      return false;
    }

    return true;
  }

  async getYoutubePlaylist(context: Context): Promise<void | Message> {
    const { msg, args } = context;
    try {
      const playlist = await client.youtube.getPlaylist(args._[0]);
      if (!playlist)
        return msg.channel.send(
          Embed.error("Playlist not found (either it doesn't exist or it's private)")
        );

      const videos = await playlist.getVideos();
      (await Promise.all(videos.map(v => client.youtube.getVideoByID(v.id)))).map(
        v =>
          v &&
          this.queueTrack(new YoutubeTrack(msg.author.id, v), {
            context,
            silent: true,
            beginPlaying: false,
          })
      );

      msg.channel.send(
        Embed.success(
          `Queued ${videos.length.toString()} videos from ` +
            `**[${playlist.title}](https://youtube.com/playlist?list=${playlist.id})**`
        )
      );

      const queue = client.queues.get(msg.guild.id);

      queue.updateNowPlaying();
      if (!queue.playing) this.playNext(context);
    } catch (err) {
      getLogger(`MESSAGE ${msg.id}`).error(err);
      if (err.toString() === 'Error: resource youtube#playlistListResponse not found')
        return msg.channel.send(
          Embed.error("Playlist not found (either it doesn't exist or it's private)")
        );

      return msg.channel.send(Embed.error(codeBlock(err)));
    }
  }

  async getYoutubeChannel(context: Context): Promise<void | Message> {
    const { msg, args } = context;

    try {
      const channel = await client.youtube.getChannel(args._[0], {
        part: 'snippet,contentDetails',
      });
      if (!channel) return msg.channel.send(Embed.error('Could not resolve channel'));

      const uploadsId = (channel.raw as any)?.contentDetails?.relatedPlaylists?.uploads;
      if (!uploadsId) return msg.channel.send(Embed.error('Channel has no uploads'));

      const uploads = await client.youtube.getPlaylistByID(uploadsId);
      if (!uploads) return msg.channel.send(Embed.error('Upload playlist not found'));

      const videos = await uploads.getVideos();
      (await Promise.all(videos.map(v => client.youtube.getVideoByID(v.id)))).map(
        v =>
          v &&
          this.queueTrack(new YoutubeTrack(msg.author.id, v), {
            context,
            silent: true,
            beginPlaying: false,
          })
      );

      msg.channel.send(
        Embed.success(
          `Queued ${videos.length.toString()} videos from ` +
            `**[${uploads.title}](https://youtube.com/playlist?list=${uploads.id})**`
        )
      );

      const queue = client.queues.get(msg.guild.id);
      if (!queue.playing) this.playNext(context);
    } catch (err) {
      // do not ask
      if (err.message.includes("Cannot read property 'length' of undefined"))
        return msg.channel.send(Embed.error('Invalid channel'));

      getLogger(`MESSAGE ${msg.id}`).error(err);
      return msg.channel.send(Embed.error(codeBlock(err)));
    }
  }

  async getYoutubeVideo(context: Context): Promise<void | Message> {
    const { msg, args } = context;

    try {
      const video = await client.youtube.getVideo(args._[0]);
      if (!video)
        return msg.channel.send(
          Embed.error("Video not found (either it doesn't exist or it's private)")
        );
      this.queueTrack(new YoutubeTrack(msg.author.id, video), { context });
    } catch (err) {
      getLogger(`MESSAGE ${msg.id}`).error(err);
      if (err.toString() === 'Error: resource youtube#videoListResponse not found')
        return msg.channel.send(
          Embed.error("Video not found (either it doesn't exist or it's private)")
        );

      return msg.channel.send(Embed.error(codeBlock(err)));
    }
  }

  async getSpotifyAlbum(context: Context): Promise<void | Message> {
    const { msg, args } = context;
    const albumId = regExps.spotify.album.exec(args._[0]);
    if (!albumId) return msg.channel.send(Embed.error('Invalid album'));

    if (!this.checkSpotify(msg)) return;

    const album = await client.spotify.getAlbum(albumId[1]);
    if (!album) return msg.channel.send(Embed.error('Invalid album'));

    for (const { name, artists, duration_ms, id } of album.body.tracks.items) {
      this.queueTrack(
        new SpotifyTrack(msg.author.id, {
          title: name,
          cover: album.body.images[0],
          artists,
          duration: toDuration(duration_ms, 'ms'),
          id,
        }),
        { context, silent: true, beginPlaying: false }
      );
    }

    const queue = client.queues.get(msg.guild.id);
    queue.updateNowPlaying();

    msg.channel.send(
      Embed.success(
        `Queued ${album.body.tracks.items.length} tracks from ` +
          `**[${album.body.name}](https://open.spotify.com/album/${album.body.id})**`,
        queue.paused ? 'music is paused btw' : undefined
      )
    );

    if (!queue.playing) this.playNext(context);
  }

  async getSpotifyPlaylist(context: Context): Promise<void | Message> {
    const { msg, args } = context;
    const playlistId = regExps.spotify.playlist.exec(args._[0]);
    if (!playlistId) return msg.channel.send(Embed.error('Invalid playlist'));

    if (!this.checkSpotify(msg)) return;

    const playlist = await client.spotify.getPlaylist(playlistId[1]);
    if (!playlist) return msg.channel.send(Embed.error('Invalid playlist'));

    for (const {
      track: { name, artists, duration_ms, id, album },
    } of playlist.body.tracks.items) {
      this.queueTrack(
        new SpotifyTrack(msg.author.id, {
          title: name,
          cover: album.images[0],
          artists,
          duration: toDuration(duration_ms, 'ms'),
          id,
        }),
        { context, silent: true, beginPlaying: false }
      );
    }

    const queue = client.queues.get(msg.guild.id);
    queue.updateNowPlaying();

    msg.channel.send(
      Embed.success(
        `Queued ${playlist.body.tracks.items.length} tracks from ` +
          `**[${playlist.body.name}](https://open.spotify.com/playlist/${playlist.body.id})**`,
        queue.paused ? 'music is paused btw' : undefined
      )
    );

    if (!queue.playing) this.playNext(context);
  }

  async getSpotifyTrack(context: Context): Promise<void | Message> {
    const { msg, args } = context;
    const trackId = regExps.spotify.track.exec(args._[0]);
    if (!trackId) return msg.channel.send(Embed.error('Invalid track'));

    if (!this.checkSpotify(msg)) return;

    const track = await client.spotify.getTrack(trackId[1]);
    if (!track) return msg.channel.send(Embed.error('Invalid track'));

    this.queueTrack(
      new SpotifyTrack(msg.author.id, {
        title: track.body.name,
        cover: track.body.album.images[0],
        artists: track.body.artists,
        id: track.body.id,
        duration: toDuration(track.body.duration_ms, 'ms'),
      }),
      { context }
    );
  }

  async searchYoutube(context: Context): Promise<void | Message> {
    const { msg, args, config } = context;

    try {
      const searchMessage = await msg.channel.send(Embed.info('loading...'));

      const search = await yts({ query: args._.join(' '), category: 'music' });

      const videos = (
        await Promise.all(search.videos.slice(0, 5).map(v => client.youtube.getVideo(v.url)))
      )
        .flatMap(v => {
          if (!v) return [];
          return {
            ...v,
            livestream: (v.raw.snippet as Record<string, string>).liveBroadcastContent === 'live',
          };
        })
        .map(data => new YoutubeTrack(msg.author.id, data));

      if (!videos.length) return searchMessage.edit(Embed.error('no results found'));

      searchMessage.edit(
        new Embed({
          title: 'choose a video',
          description: videos
            .filter(t => !!t)
            .map(
              (track, index) =>
                `${index + 1}. ` + `**[${track.title}](${track.url})**` + ` (${track.duration})`
            )
            .join('\n'),
        })
      );

      const collector = msg.channel.createMessageCollector(
        (message: Message) => message.author.id === msg.author?.id,
        { idle: 15000 }
      );

      enum StopReason {
        CANCEL = 'cancel',
        PLAYCMD = 'playcmd',
      }

      let index: number;
      collector.on('collect', (collected: Message) => {
        if (collected.content.startsWith(`${config.prefix}cancel`))
          return collector.stop(StopReason.CANCEL);
        if (new RegExp(`^\\${config.prefix}p(lay)?`).test(collected.content))
          return collector.stop(StopReason.PLAYCMD);

        const i = parseInt(collected.content);
        if (isNaN(i) || i < 1 || i > videos.length)
          return msg.channel.send(Embed.warning('invalid selection, try again'));

        index = i;
        collector.stop();
      });

      collector.on('end', async (collected, reason) => {
        if (reason === StopReason.PLAYCMD) return;
        if (reason === StopReason.CANCEL) return msg.channel.send(Embed.info('cancelled'));
        if (!index || Number.isNaN(index) || index < 1 || index > videos.length)
          return msg.channel.send(Embed.error("invalid selection, time's up"));

        const video = videos[index - 1];
        if (!video)
          throw new Error('invalid state: video is null after selecting valid returned search');

        this.queueTrack(video, { context });
      });
    } catch (err) {
      getLogger(`MESSAGE ${msg.id}`).error(err);
      return msg.channel.send(codeBlock(err));
    }
  }

  async queueTrack(
    track: Track,
    options: { context: Context; silent?: boolean; beginPlaying?: boolean }
  ): Promise<void> {
    const { msg } = options.context;

    const queue = client.queues.get(msg.guild.id);
    queue.tracks.push(track);
    queue.textChannel = msg.channel as TextChannel;

    if (!queue.playing && (options?.beginPlaying ?? true)) {
      queue.index = queue.tracks.length - 1;
      this.playNext(options.context);
    } else if (!(options?.silent ?? false)) {
      msg.channel.send(
        Embed.success(
          `**[${track.data.title}](${track.url})** queued (#${queue.tracks.length - 1} in queue)`,
          queue.paused ? 'music is paused btw' : undefined
        )
      );
      queue.updateNowPlaying();
    }
  }

  async playNext(context: Context): Promise<void | Message> {
    const { msg } = context;

    const queue = client.queues.get(msg.guild.id);

    const track = queue.tracks[queue.index];

    if (!queue.playing) {
      queue.voiceChannel = msg.member?.voice?.channel as VoiceChannel;
      queue.playing = true;
    }

    queue.voiceChannel && (queue.voiceConnection = await queue.voiceChannel.join());
    await queue.voiceConnection?.voice?.setSelfDeaf(true);

    queue.updateNowPlaying();

    const callback = async (info: unknown) => {
      const queue = client.queues.get(msg.guild.id);

      getLogger(`MESSAGE ${msg.id}`).debug(`track "${track.data.title}" ended with info "${info}"`);

      queue.embed?.delete();
      delete queue.embed;

      if (!queue.playing) {
        queue.voiceConnection?.disconnect();
        return;
      }

      if (queue.loop === 'one') return this.playNext(context);

      const nextTrack = queue.tracks[queue.index + 1];
      if (!nextTrack) {
        if (queue.loop === 'all') {
          queue.index = 0;
          this.playNext(context);
        } else {
          // no more in queue and not looping
          queue.voiceConnection?.disconnect();
          delete queue.voiceConnection;
          delete queue.voiceChannel;
          queue.playing = false;
          return;
        }
      } else {
        queue.index++;
        return this.playNext(context);
      }
    };

    const options: StreamOptions = {
      highWaterMark: 20,
      volume: false,
    };

    try {
      queue.voiceConnection
        ?.play(await track.getPlayable(), options)
        .on('close', callback)
        .on('error', err => logger.error(err));
    } catch (err) {
      queue.embed?.edit(Embed.error(err.message));
      return callback('error');
    }
  }
}
