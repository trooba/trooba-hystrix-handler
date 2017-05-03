'use strict';

const Assert = require('assert');
const Trooba = require('trooba');
const Async = require('async');

const commandFactory = require('hystrixjs').commandFactory;
const metricsFactory = require('hystrixjs').metricsFactory;
const circuitFactory = require('hystrixjs').circuitFactory;

const handler = require('..');

describe(__filename, () => {
    let metrics = [];

    before(() => {
        process.on('trooba:hystrix:data', data => metrics.push(JSON.parse(data)));
    });

    after(() => {
        metricsFactory.resetCache();
        circuitFactory.resetCache();
        commandFactory.resetCache();
    });

    it('should run a handler', next => {
        const pipe = Trooba.use(handler, {
            protocol: 'http:',
            hostname: 'localhost'
        })
        .use(pipe => {
            pipe.on('request', request => {
                pipe.respond(request);
            });
        })
        .build();

        pipe.create().request('hello', (err, response) => {
            if (err) {
                next(err);
                return;
            }
            Assert.ok(!err, err && err.stack);
            Assert.equal('hello', response);
            next();
        });
    });

    it('should catch error', next => {
        const pipe = Trooba.use(handler, {
            protocol: 'http:',
            hostname: 'localhost'
        })
        .use(pipe => {
            pipe.on('request', request => {
                pipe.throw(new Error('Boom'));
            });
        })
        .build();

        pipe.create().request('hello', err => {
            Assert.ok(err);
            Assert.equal('Boom', err.message);
            next();
        });
    });

    it('should have metrics published', next => {
        process.once('trooba:hystrix:data', () => {
            Assert.equal(1, metrics.length);
            Assert.equal('HystrixCommand', metrics[0].type);
            Assert.equal(1, metrics[0].errorCount);
            Assert.equal(2, metrics[0].requestCount);
            Assert.equal(1, metrics[0].rollingCountFailure);
            Assert.equal(1, metrics[0].rollingCountSuccess);
            next();
        });
    });

    describe('circuit', () => {
        let RATE = 5;
        let counter = 0;
        let latency = 100;

        const pipe = Trooba.use(handler, {
            command: 'op1',
            circuitBreakerSleepWindowInMilliseconds: 1000
        })
        .use(pipe => {
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
        })
        .build();

        before(() => {
            metricsFactory.resetCache();
            circuitFactory.resetCache();
            commandFactory.resetCache();

            metrics = [];
        });

        it('should do a lot of requests, 20% failure rate', next => {
            counter = 0;

            Async.times(300, (index, next) => {
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
            }, () => next());
        });

        it('wait for metrics publish', next => process.once('trooba:hystrix:data', () => next()));

        it('should accumulate stats', next => {
            Assert.equal(20, metrics[0].errorPercentage);
            Assert.equal(false, metrics[0].isCircuitBreakerOpen);
            metrics = [];
            next();
        });

        it('should open circuit', next => {
            RATE = 1; // 100% of failures
            latency = 100;
            counter = 0;

            Async.times(300, (index, next) => {
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
            }, next);
        });

        it('wait for metrics publish', next => process.once('trooba:hystrix:data', () => next()));

        it('validate open circuit', () => {
            Assert.equal(true, metrics[0].isCircuitBreakerOpen);
            Assert.equal(60, metrics[0].errorPercentage);

            metrics = [];
        });

        it('wait for metrics publish', next => process.once('trooba:hystrix:data', () => next()));

        it('should keep circuit open', () => {
            Assert.equal(true, metrics[0].isCircuitBreakerOpen);
            Assert.equal(60, metrics[0].errorPercentage);

            metrics = [];
        });

        it('should close circuit', next => {
            RATE = 200; // disable failure
            counter = 0;

            Async.times(100, (index, next) => {
                pipe.create().request('hello', (err, response) => {
                    if (err) {
                        Assert.equal('OpenCircuitError', err.message);
                        next();
                        return;
                    }
                    Assert.ok(!err, err && err.stack);
                    Assert.equal('hello', response);
                    next();
                });
            }, next);
        });

        it('wait for metrics publish', next => process.once('trooba:hystrix:data', () => next()));

        it('validate closed circuit', () => {
            Assert.equal(false, metrics.pop().isCircuitBreakerOpen);

            metrics = [];
        });

        it('wait for metrics publish', next => process.once('trooba:hystrix:data', () => next()));

        it('should accumulate above stats', () => {
            Assert.ok(metrics[0].latencyExecute['99.5'] > 100);
        });
    });


    describe('circuit, multiple services', () => {
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
            const pipe = Trooba.use(handler, {
                command: 'op' + i,
                circuitBreakerSleepWindowInMilliseconds: 1000
            })
            .use(transport)
            .build();

            pipes.push(pipe);
        }


        before(() => {
            metricsFactory.resetCache();
            circuitFactory.resetCache();
            commandFactory.resetCache();
            metrics = [];
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

        it('wait for metrics publish', next => process.once('trooba:hystrix:data', () => next()));

        it('check stats', () => {
            // Assert.equal(false, metrics.pop().isCircuitBreakerOpen);
            Assert.equal(10, metrics.length);
            metrics.forEach(metric => {
                Assert.ok(metric.errorPercentage < 30 && metric.errorPercentage > 5);
                Assert.equal(100, metric.requestCount, `Actual ${metric}`);
            });

            metrics = [];
        });

    });
});

Math.seed = 6;

// in order to work 'Math.seed' must NOT be undefined,
// so in any case, you HAVE to provide a Math.seed
Math.seededRandom = function(max, min) {
    max = max || 1;
    min = min || 0;

    Math.seed = (Math.seed * 9301 + 49297) % 233280;
    var rnd = Math.seed / 233280;

    return min + rnd * (max - min);
};
