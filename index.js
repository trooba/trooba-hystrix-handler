'use strict';

const CommandsFactory = require('hystrixjs').commandFactory;
const hystrixStream = require('hystrixjs').hystrixSSEStream;

hystrixStream.toObservable().subscribe(
    sseData => process.emit('trooba:hystrix:data', sseData),
    err => {},
    () => {}
);

module.exports = function hystrix(pipe, config) {

    pipe.once('request', (request, next) => {
        const protocol = config.protocol || 'https:';
        const port = protocol === 'http:' ? 80 : 443;
        const name = config.command || `${protocol}//${config.hostname}:${port}`;
        const serviceCommandBuilder = CommandsFactory.getOrCreate(name, config.group)
        .run(function run(pipe, next) {
            return new Promise((resolve, reject) => {
                pipe.once('response', resolve);
                pipe.once('error', reject);
                next();
            });
        });

        Object.assign(serviceCommandBuilder.config, config);

        const serviceCommand = serviceCommandBuilder.build();

        serviceCommand.execute(pipe, next)
        .then(response => pipe.respond(response))
        .catch(err => pipe.throw(err));
    });
};
