'use strict';

const commandFactory = require('hystrixjs').commandFactory;
const circuitFactory = require('hystrixjs').circuitFactory;
const hystrixStream = require('hystrixjs').hystrixSSEStream;

hystrixStream.toObservable().subscribe(
    sseData => process.emit('trooba:hystrix:data', sseData),
    err => {},
    () => {}
);

module.exports = function hystrix(pipe, config) {

    // configure
    const protocol = config.protocol || 'https:';
    const port = protocol === 'http:' ? 80 : 443;
    const name = config.command || `${protocol}//${config.hostname}:${port}`;
    const serviceCommandBuilder = commandFactory.getOrCreate(name, config.group)
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
        // pass pipe reference to the current flow
        serviceCommand.execute(pipe, next)
        .then(response => pipe.respond(response))
        .catch(err => pipe.throw(err));
    });
};

module.exports.circuitFactory = circuitFactory;
