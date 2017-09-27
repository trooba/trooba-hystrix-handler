'use strict';

const Assert = require('assert');

const commandFactory = require('hystrixjs').commandFactory;
const circuitFactory = require('hystrixjs').circuitFactory;
const metricsFactory = require('hystrixjs').metricsFactory;

module.exports = function hystrix(pipe, config) {

    const command = pipe.context.command || config && config.command;
    const group = pipe.context.commandGroup || config && config.commandGroup;

    Assert.ok(command, 'Command name should be provided');

    // configure
    const serviceCommandBuilder = commandFactory.getOrCreate(command, group)
    .run(runCommand);

    pipe.context.fallback = pipe.context.fallback || config && config.fallback;

    // configure once if it is not already cached
    Object.assign(serviceCommandBuilder.config, config, {
        fallback: defaultFallback
    });

    const serviceCommand = serviceCommandBuilder.build();

    // trooba pipeline request flow
    pipe.on('request', (request, next) => {
        // pass pipe reference to the command run function
        serviceCommand.execute({
            request: request,
            pipe: pipe,
            next: next
        })
        .then(response => {
            if (response.next) {
                return response.next();
            }
            // start only fallback response here
            pipe.respond(response);
        })
        .catch(err => {
            // start only open circuit errors here
            !err.skip && pipe.throw(err);
        });
    });
};

function defaultFallback(err, args) {
    const ctx = args.shift();
    const pipe = ctx.pipe;
    // this pipe reference points to underlying request flow context
    if (pipe.context.fallback) {
        return pipe.context.fallback(err, ctx.request);
    }
    return Promise.reject(err);
}

function runCommand(ctx) {
    return new Promise((resolve, reject) => {
        ctx.pipe.removeListener('response');
        ctx.pipe.removeListener('response:data');
        ctx.pipe.removeListener('error');
        ctx.pipe.once('response', (response, next) => {
            // record hystrix success
            resolve({
                next: next
            });
        });

        // use it to decide if we can still do fallback when deal with stream data;
        ctx.pipe.once('response:data', (data, next) => {
            ctx.pipe.context.fallback = undefined;
            next();
        });
        ctx.pipe.once('error', (err, next) => {
            // record rejection in hystrix
            err.skip = true;
            reject(err);
            // allow err to get recorded in hystrix so we can react on it in the
            // handler down the response pipe
            setImmediate(() => {
                // if fallback is not specified or deleted after data flush
                if (!ctx.pipe.context.fallback) {
                    // continue pipe flow if needed
                    next();
                }
            });
        });
        ctx.next();
    });
}

module.exports.circuitFactory = circuitFactory;
module.exports.metricsFactory = metricsFactory;
module.exports.commandFactory = commandFactory;
