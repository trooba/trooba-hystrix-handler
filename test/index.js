'use strict';

const Assert = require('assert');
const Trooba = require('trooba');
const Async = require('async');

const Hystrix = require('hystrixjs');
const commandFactory = Hystrix.commandFactory;
const metricsFactory = Hystrix.metricsFactory;
const circuitFactory = Hystrix.circuitFactory;

const HystrixDashboard = require('hystrix-dashboard');

const handler = require('..');

describe(__filename, () => {
    let metrics = [];

    before(() => {
        process.on('trooba:hystrix:data', data => metrics.push(JSON.parse(data)));

        HystrixDashboard.Utils.toObservable(Hystrix, 2000).subscribe(
            sseData => process.emit('trooba:hystrix:data', sseData),
            err => {},
            () => {}
        );
    });

    after(() => {
        metricsFactory.resetCache();
        circuitFactory.resetCache();
        commandFactory.resetCache();
    });

    it('should handle request', next => {
        const pipe = Trooba.use(handler, {
            command: 'foo'
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
            command: 'foo'
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

    it('should catch timeout error', next => {
        const pipe = Trooba.use(handler, {
            command: 'timeout',
            timeout: 1
        })
        .use(pipe => {
            pipe.on('request', request => {
            });
        })
        .build();

        pipe.create().request('hello', err => {
            Assert.ok(err);
            Assert.equal('CommandTimeOut', err.message);
            next();
        });
    });

    describe('fallback', () => {
        it('should return error when no fallback available', next => {
            const pipe = Trooba.use(handler, {
                command: 'foo'
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

        it('should catch error and do fallback provided via config', next => {
            const pipe = Trooba.use(handler, {
                command: 'foo',
                fallback: (err, request) => {
                    Assert.equal('hello', request);
                    return Promise.resolve('fallback');
                }
            })
            .use(pipe => {
                pipe.on('request', request => {
                    pipe.throw(new Error('Boom'));
                });
            })
            .build();

            pipe.create().request('hello', (err, res) => {
                Assert.ok(!err, err && err.stack);
                Assert.equal('fallback', res);
                next();
            });
        });

        it('should catch error and do fallback with resolve', next => {
            const pipe = Trooba.use(handler, {
                command: 'foo'
            })
            .use(pipe => {
                pipe.on('request', request => {
                    pipe.throw(new Error('Boom'));
                });
            })
            .build({
                fallback: (err, request) => {
                    Assert.equal('hello', request);
                    return Promise.resolve('fallback');
                }
            });

            pipe.create().request('hello', (err, res) => {
                Assert.equal('fallback', res);
                next();
            });
        });

        it('should catch error and do fallback with reject', next => {
            const pipe = Trooba.use(handler, {
                command: 'foo'
            })
            .use(pipe => {
                pipe.on('request', request => {
                    pipe.throw(new Error('Boom'));
                });
            })
            .build({
                fallback: (err, request) => {
                    Assert.equal('hello', request);
                    return Promise.reject(new Error('Fallback boom'));
                }
            });

            pipe.create().request('hello', err => {
                Assert.equal('Fallback boom', err.message);
                next();
            });
        });

        it('should use fallback from context', next => {
            const pipe = Trooba.use(handler, {
                command: 'foo'
            })
            .use(pipe => {
                pipe.on('request', request => {
                    pipe.throw(new Error('Boom'));
                });
            })
            .build();

            pipe.create({
                fallback: (err, args) => {
                    return Promise.resolve('ctx_fallback');
                }
            }).request('hello', (err, res) => {
                Assert.equal('ctx_fallback', res);
                next();
            });
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

    describe('command context', () => {
        after(() => {
            metricsFactory.resetCache();
            circuitFactory.resetCache();
            commandFactory.resetCache();
        });

        it('should fail without command name', () => {
            Assert.throws(() => {
                Trooba.use(handler)
                .use(pipe => {
                    pipe.on('request', request => {
                        pipe.respond(request);
                    });
                })
                .build()
                .create()
                .request();
            }, /Command name should be provided/);
        });

        it('should use command name and group from context', next => {
            Trooba.use(handler)
            .use(pipe => {
                pipe.on('request', request => {
                    pipe.respond(request);
                });
            })
            .build()
            .create({
                command: 'foo',
                commandGroup: 'bar'
            })
            .request({}, next);
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

        it('should force open', next => {
            RATE = 1000; // 100% of failures
            counter = 0;
            circuitFactory.getOrCreate({
                commandKey: 'op1'
            }).circuitBreakerForceOpened = true;

            pipe.create().request('hello', (err, response) => {
                if (err) {
                    Assert.equal('OpenCircuitError', err.message);
                    next();
                    return;
                }
                next(new Error('Should have failed'));
            });
        });

        it('should be back to regular', next => {
            RATE = 1000; // 100% of failures
            counter = 0;
            const cb = circuitFactory.getOrCreate({
                commandKey: 'op1'
            });
            cb.circuitBreakerForceClosed = false;
            cb.circuitBreakerForceOpened = false;

            pipe.create().request('hello', (err, response) => {
                if (err) {
                    next(new Error('Should not have fail'));
                    return;
                }
                next();
            });
        });

        it('should force close', next => {
            RATE = 1000; // 100% of failures
            counter = 0;
            const cb = circuitFactory.getOrCreate({
                commandKey: 'op1'
            });
            cb.circuitBreakerForceClosed = true;
            cb.circuitBreakerForceOpened = false;

            pipe.create().request('hello', (err, response) => {
                if (err) {
                    next(new Error('Should not fail'));
                    return;
                }
                next();
            });
        });

        it('should be back to regular, success', next => {
            RATE = 1000; // 100% of failures
            counter = 0;
            const cb = circuitFactory.getOrCreate({
                commandKey: 'op1'
            });
            cb.circuitBreakerForceClosed = false;
            cb.circuitBreakerForceOpened = false;

            pipe.create().request('hello', (err, response) => {
                if (err) {
                    next(new Error('Should not fail'));
                    return;
                }
                next();
            });
        });

        it('should force close and never open', next => {
            RATE = 1; // 100% of failures
            counter = 0;
            const cb = circuitFactory.getOrCreate({
                commandKey: 'op1'
            });
            cb.circuitBreakerForceClosed = true;
            cb.circuitBreakerForceOpened = false;

            Async.times(600, (index, next) => {
                pipe.create().request('hello', (err, response) => {
                    if (err) {
                        Assert.equal('Boom', err.message);
                        next();
                        return;
                    }
                    next(new Error('Should have failed'));
                });
            }, next);
        });

        it('should be back to regular, fail', next => {
            RATE = 1000; // 100% of failures
            counter = 0;
            const cb = circuitFactory.getOrCreate({
                commandKey: 'op1'
            });
            cb.circuitBreakerForceClosed = false;
            cb.circuitBreakerForceOpened = false;

            pipe.create().request('hello', (err, response) => {
                if (err) {
                    Assert.equal('OpenCircuitError', err.message);
                    next();
                    return;
                }
                next(new Error('Should fail'));
            });
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
                Assert.ok(metric.errorPercentage <= 30 && metric.errorPercentage >= 5, `Actual value ${metric.errorPercentage}`);
                Assert.equal(100, metric.requestCount, `Actual ${metric}`);
            });

            metrics = [];
        });

    });

    describe('streaming', () => {
        it('should handle stream data and preserve data order', next => {
            const pipe = Trooba
            .use(pipe => {
                let _response;
                pipe.on('response', (response, next) => {
                    _response = response;
                    Assert.equal('pong', _response);
                    next();
                });
                pipe.on('response:data', (data, next) => {
                    Assert.equal('pong', _response);
                    if (data === undefined) {
                        return next();
                    }
                    Assert.ok(data === 'data1' || data === 'data2');
                    next();
                });
            })
            .use(handler, {
                command: 'foo'
            })
            .use(pipe => {
                pipe.once('request', request => {
                    const stream = pipe.streamResponse('pong');
                    stream.write('data1');
                    stream.write('data2');
                    stream.end();
                });
            })
            .build();

            pipe.create().request('ping')
            .once('error', next)
            .once('response', response => {
                Assert.equal('pong', response);
                next();
            })
            .on('response:data', (data, next) => {
                if (data === undefined) {
                    return next();
                }
                Assert.ok(data === 'data1' || data === 'data2');
                next();
            });
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
