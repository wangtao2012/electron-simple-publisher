'use strict';

const fs   = require('fs');
const path = require('path');
const AWS  = require('aws-sdk');

const AbstractTransport = require('./abstract');

class S3Transport extends AbstractTransport {
  /**
   * @param {object} options
   * @param {object} options.transport
   * @param {string} options.transport.accessKeyId
   * @param {string} options.transport.secretAccessKey
   * @param {Object} [options.transport.aws]
   * @param {string|Object}  options.transport.bucket
   */
  constructor(options) {
    super(options);
    this.normalizeOptions();
  }

  normalizeOptions() {
    const options = this.options;

    const awsAuth = {
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
      signatureVersion: 'v4'
    };
    options.aws = Object.assign(awsAuth, options.aws);
    for (const name of ['accessKeyId', 'secretAccessKey']) {
      if (!options.aws[name]) {
        throw new Error(`The transport.${name} option is not set`);
      }
    }

    if (!options.bucket) {
      options.bucket = this.commandOptions.packageJson.name + '-updates';
    }


    if (typeof options.bucket === 'string') {
      options.bucket = { Bucket: options.bucket };
    }

    if (!options.bucket.Bucket) {
      throw new Error(`The transport.bucket option is not set`);
    }
  }

  init() {
    AWS.config.update(this.options.aws);
    //noinspection JSCheckFunctionSignatures
    this.s3 = new AWS.S3({ apiVersion: '2006-03-01' });
    this.q = this.createBucket(this.options.bucket);
  }

  /**
   * Upload file to a hosting and get its url
   * @abstract
   * @param {string} filePath
   * @param {object} build
   * @return {Promise<string>} File url
   */
  uploadFile(filePath, build) {
    const remotePath = this.getRemoteFilePath(filePath, build);
    const bucket = this.options.bucket.Bucket;

    return this.q
      .then(() => {
        return this.s3.putObject({
          ACL: 'public-read',
          Body: fs.createReadStream(filePath),
          Bucket: bucket,
          Key: remotePath
        })
          .on('httpUploadProgress', (progress) => {
            this.setProgress(filePath, progress.loaded, progress.total);
          })
          .promise();
      })
      .then(() => `https://${bucket}.s3.amazonaws.com/${remotePath}`);
  }

  /**
   * Save updates.json to a hosting
   * @return {Promise<string>} Url to updates.json
   */
  pushUpdatesJson(data) {
    const bucket = this.options.bucket.Bucket;
    return this.q
      .then(() => {
        return this.s3.putObject({
          ACL: 'public-read',
          Body: JSON.stringify(data, null, '  '),
          Bucket: bucket,
          Key: 'updates.json'
        }).promise();
      })
      .then(() => this.getUpdatesJsonUrl());
  }

  /**
   * @return {Promise<Array<string>>}
   */
  fetchBuildsList() {
    const bucket = this.options.bucket.Bucket;
    return this.q
      .then(() => {
        return this.s3.listObjectsV2({ Bucket: bucket }).promise();
      })
      .then((response) => {
        return response.Contents
          .map(item => item.Key)
          .map(key => key.split('/')[0])
          .filter(key => key.match(/^\w+-\w+-\w+-[\w.]+$/))
          .filter((item, pos, self) => self.indexOf(item) === pos);
      });
  }

  /**
   * @return {Promise}
   */
  removeBuild(build) {
    const bucket = this.options.bucket.Bucket;
    const buildId = this.getBuildId(build);

    return this.q
      .then(() => {
        return this.s3.listObjectsV2({ Bucket: bucket }).promise();
      })
      .then((response) => {
        return response.Contents
          .map(item => item.Key)
          .filter(key => key.startsWith(buildId));
      })
      .then((keys) => {
        return this.s3.deleteObjects({
          Bucket: bucket,
          Delete: {
            Objects: keys.map(key => ({ Key: key }))
          }
        }).promise();
      });
  }

  createBucket(bucketOptions) {
    return this.s3.headBucket({ Bucket: bucketOptions.Bucket })
      .promise()
      .catch(() => {
        return this.s3.createBucket(bucketOptions).promise();
      });
  }

  getRemoteFilePath(localFilePath, build) {
    localFilePath = path.basename(localFilePath);
    return path.posix.join(
      this.getBuildId(build),
      this.normalizeFileName(localFilePath)
    );
  }
}

module.exports = S3Transport;