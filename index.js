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
        fallback: (err, args) => {
            const ctx = args.shift();
            const pipe = ctx.pipe;
            // this pipe reference points to underlying request flow context
            if (pipe.context.fallback) {
                return pipe.context.fallback(err, ctx.request);
            }
            return Promise.reject(err);
        }
    });

    const serviceCommand = serviceCommandBuilder.build();

    // trooba pipeline request flow
    pipe.once('request', (request, next) => {
        // pass pipe reference to the command run function
        serviceCommand.execute({
            request: request,
            pipe: pipe,
            next: next
        })
        .then(response => pipe.respond(response))
        .catch(err => pipe.throw(err));
    });
};

function runCommand(ctx) {
    return new Promise((resolve, reject) => {
        ctx.pipe.once('response', resolve);
        ctx.pipe.once('error', reject);
        ctx.next();
    });
}

module.exports.circuitFactory = circuitFactory;
module.exports.metricsFactory = metricsFactory;
module.exports.commandFactory = commandFactory;
