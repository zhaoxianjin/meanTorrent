'use strict';

var path = require('path'),
  config = require(path.resolve('./config/config')),
  mongoose = require('mongoose'),
  chalk = require('chalk'),
  CronJob = require('cron').CronJob,
  moment = require('moment'),
  Torrent = mongoose.model('Torrent'),
  User = mongoose.model('User'),
  Peer = mongoose.model('Peer'),
  backup = require('mongodb-backup');

var appConfig = config.meanTorrentConfig.app;
var backupConfig = config.meanTorrentConfig.backup;
var announceConfig = config.meanTorrentConfig.announce;

const PEERSTATE_SEEDER = 'seeder';
const PEERSTATE_LEECHER = 'leecher';

/**
 * cron params of time
 *
 * Seconds: 0-59
 * Minutes: 0-59
 * Hours: 0-23
 * Day of Month: 1-31
 * Months: 0-11
 * Day of Week: 0-6
 *
 *
 * CronJob
 *
 * constructor(cronTime, onTick, onComplete, start, timezone, context, runOnInit) - Of note, the first parameter here can be a JSON object that has
 * the below names and associated types (see examples above).
 *    cronTime - [REQUIRED] - The time to fire off your job. This can be in the form of cron syntax or a JS Date object.
 *    onTick - [REQUIRED] - The function to fire at the specified time.
 *    onComplete - [OPTIONAL] - A function that will fire when the job is complete, when it is stopped.
 *    start - [OPTIONAL] - Specifies whether to start the job just before exiting the constructor. By default this is set to false. If left at
 *            default you will need to call job.start() in order to start the job (assuming job is the variable you set the cronjob to). This does
 *            not immediately fire your onTick function, it just gives you more control over the behavior of your jobs.
 *    timeZone - [OPTIONAL] - Specify the timezone for the execution. This will modify the actual time relative to your timezone. If the timezone is
 *                invalid, an error is thrown.
 *    context - [OPTIONAL] - The context within which to execute the onTick method. This defaults to the cronjob itself allowing you to call this.stop().
 *              However, if you change this you'll have access to the functions and values within your context object.
 *    runOnInit - [OPTIONAL] - This will immediately fire your onTick function as soon as the requisit initialization has happened. This option is
 *                set to false by default for backwards compatibility.
 * start - Runs your job.
 * stop - Stops your job.
 *
 * @param app
 */
module.exports = function (app) {
  var cronJobs = [];

  cronJobs.push(cronJobHnR());

  if (backupConfig.enable) {
    cronJobs.push(cronJobBackupMongoDB());
    cronJobs.push(removeGhostPeers());
  }

  return cronJobs;
};

/**
 * cronJobHnR
 */
function cronJobHnR() {
  var cronJob = new CronJob({
    //cronTime: '00 00 1 * * *',
    //cronTime: '*/5 * * * * *',
    cronTime: '00 00 * * * *',
    onTick: function () {
      console.log(chalk.green('cronJob: process!'));
    },
    onComplete: function () {
      console.log(chalk.green('cronJob: complete!'));
    },
    start: false,
    timeZone: appConfig.cronTimeZone
  });

  cronJob.start();

  return cronJob;
}

/**
 * cronJobBackupMongoDB
 */
function cronJobBackupMongoDB() {
  var cronJob = new CronJob({
    cronTime: '00 00 1 * * *',
    //cronTime: '*/5 * * * * *',
    //cronTime: '00 00 * * * *',
    onTick: function () {
      console.log(chalk.green('cronJobBackupMongoDB: process!'));

      backup({
        uri: config.db.uri, // mongodb://<dbuser>:<dbpassword>@<dbdomain>.mongolab.com:<dbport>/<dbdatabase>
        options: config.db.options || {},
        root: backupConfig.dir,
        parser: 'json',
        tar: appConfig.name + '-backup-mongodb-' + moment().format('YYYYMMDD-HHmmss') + '.tar'
      });
    },
    onComplete: function () {
      console.log(chalk.green('cronJobBackupMongoDB: complete!'));
    },
    start: false,
    timeZone: appConfig.cronTimeZone
  });

  cronJob.start();

  return cronJob;
}

function removeGhostPeers() {
  var cronJob = new CronJob({
    cronTime: '00 00 1 * * *',
    //cronTime: '*/5 * * * * *',
    onTick: function () {
      console.log(chalk.green('removeGhostPeers: process!'));

      Peer.find({
        last_announce_at: {$lt: Date.now() - announceConfig.ghostPeersCheck.ghostPeersIdleTime}
      })
        .populate('user')
        .populate('torrent')
        .exec(function (err, peers) {
          if (!err && peers) {
            var count = peers.length;

            peers.forEach(function (p) {
              if (p.peer_status === PEERSTATE_LEECHER) {
                p.torrent.update({
                  $inc: {torrent_leechers: -1}
                }).exec();
                p.user.update({
                  $inc: {leeched: -1}
                }).exec();
              } else if (p.peer_status === PEERSTATE_SEEDER) {
                p.torrent.update({
                  $inc: {torrent_seeds: -1}
                }).exec();
                p.user.update({
                  $inc: {seeded: -1}
                }).exec();
              }

              p.torrent.update({
                $pull: {_peers: p._id}
              }).exec();

              p.remove();
            });

            console.log(chalk.green('removed ghost peers: ' + count));
          }
        });
    },
    onComplete: function () {
      console.log(chalk.green('removeGhostPeers: complete!'));
    },
    start: false,
    timeZone: appConfig.cronTimeZone
  });

  cronJob.start();

  return cronJob;
}
