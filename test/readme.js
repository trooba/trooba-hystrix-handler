'use strict';

const express = require('express');
const dashboard = require('hystrix-dashboard');

const Assert = require('assert');
const Http = require('http');
const Trooba = require('trooba');
const Async = require('async');

const commandFactory = require('hystrixjs').commandFactory;
const metricsFactory = require('hystrixjs').metricsFactory;
const circuitFactory = require('hystrixjs').circuitFactory;

const hystrixHandler = require('..');

describe(__filename, () => {
    describe('integration with hystrix dashboard', () => {
        let app;
        let port;

        let RATE = 5;
        let counter = 0;
        let latency = 100;
        let pipes = [];

        const transport = pipe => {
            pipe.on('request', request => {
                setTimeout(() => {
                    counter++;
                    if (counter % RATE === 0) {
                        pipe.throw(new Error('Boom'));
                        return;
                    }
                    pipe.respond(request);
                }, latency);
            });
        };

        for (var i = 0; i < 10; i++) {
            const pipe = Trooba.use(hystrixHandler, {
                command: 'op' + i,
                circuitBreakerSleepWindowInMilliseconds: 1000
            })
            .use(transport)
            .build();

            pipes.push(pipe);
        }

        function cleanAll() {
            metricsFactory.resetCache();
            circuitFactory.resetCache();
            commandFactory.resetCache();
        }

        after(cleanAll);

        before(next => {
            cleanAll();

            app = express();
            app.use('/console', dashboard({
                topic: 'trooba:hystrix:data' // <<< configurable hystrix metrics topic that trooba hystrix handler uses
            }));

            const svr = app.listen(() => {
                port = svr.address().port;
                console.log(`Listening to ${port}`);
                next();
            });
        });

        it('should do a lot of requests, 20% failure rate', next => {
            counter = 0;
            RATE = 5;

            Async.times(100, (index, next) => {
                Async.each(pipes, (pipe, next, index) => {
                    setTimeout(() => {
                        pipe.create().request('hello', (err, response) => {
                            if (err) {
                                Assert.equal('Boom', err.message);
                                next();
                                return;
                            }
                            Assert.ok(!err, err && err.stack);
                            Assert.equal('hello', response);
                            next();
                        });
                    }, Math.round(Math.seededRandom(0, 10)));
                }, next);
            }, () => next());
        });

        it('test', function (next) {

            let data = [];
            const req = Http.get(`http://localhost:${port}/console/hystrix.stream`, res => {
                const statusCode = res.statusCode;
                const contentType = res.headers['content-type'];

                Assert.equal(200, statusCode);
                Assert.equal('text/event-stream;charset=UTF-8', contentType);

                res.setEncoding('utf8');
                res.on('data', chunk => data.push(chunk))
                .on('end', () => {
                    Assert.equal(10, data.length);
                    data.forEach(d => {
                        Assert.ok(d.indexOf('HystrixCommand') !== -1);
                    });
                    next();
                });
            })
            .once('error', next);

            process.once('trooba:hystrix:data', data => {
                setTimeout(() => {
                    req.abort();
                }, 500);
            });
        });
    });
});
