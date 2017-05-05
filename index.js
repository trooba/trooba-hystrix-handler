'use strict';

const Assert = require('assert');

const commandFactory = require('hystrixjs').commandFactory;
const circuitFactory = require('hystrixjs').circuitFactory;
const hystrixStream = require('hystrixjs').hystrixSSEStream;
const metricsFactory = require('hystrixjs').metricsFactory;

hystrixStream.toObservable().subscribe(
    sseData => process.emit('trooba:hystrix:data', sseData),
    err => {},
    () => {}
);

module.exports = function hystrix(pipe, config) {

    const command = pipe.context.command || config && config.command;
    const group = pipe.context.commandGroup || config && config.commandGroup;

    Assert.ok(command, 'Command name should be provided');

    // configure
    const serviceCommandBuilder = commandFactory.getOrCreate(command, group)
    .run(function run(pipe, next) {
        return new Promise((resolve, reject) => {
            pipe.once('response', resolve);
            pipe.once('error', reject);
            next();
        });
    });

    // configure once if it is not already cached
    Object.assign(serviceCommandBuilder.config, config);
    const serviceCommand = serviceCommandBuilder.build();

    // trooba pipeline request flow
    pipe.once('request', (request, next) => {
        // pass pipe reference to the command run function
        serviceCommand.execute(pipe, next)
        .then(response => pipe.respond(response))
        .catch(err => pipe.throw(err));
    });
};

module.exports.circuitFactory = circuitFactory;
module.exports.metricsFactory = metricsFactory;
module.exports.commandFactory = commandFactory;
