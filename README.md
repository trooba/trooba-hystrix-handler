trooba-hystrix-handler
======================

Trooba handler that provides Hystrix functionality to [trooba](https://github.com/trooba/trooba) based service pipelines.

[![codecov](https://codecov.io/gh/trooba/trooba-hystrix-handler/branch/master/graph/badge.svg)](https://codecov.io/gh/trooba/trooba-hystrix-handler)
[![Build Status](https://travis-ci.org/trooba/trooba-hystrix-handler.svg?branch=master)](https://travis-ci.org/trooba/trooba-hystrix-handler) [![NPM](https://img.shields.io/npm/v/trooba-hystrix-handler.svg)](https://www.npmjs.com/package/trooba-hystrix-handler)
[![Downloads](https://img.shields.io/npm/dm/trooba-hystrix-handler.svg)](http://npm-stat.com/charts.html?package=trooba-hystrix-handler)
[![Known Vulnerabilities](https://snyk.io/test/github/trooba/trooba-hystrix-handler/badge.svg)](https://snyk.io/test/github/trooba/trooba-hystrix-handler)


### Install

```bash
npm install trooba-hystrix-handler -S
```

### Usage

The component collects services metrics and publishes it to process event stream under the topic 'trooba:hystrix:data'.

#### Pipeline configuration

```js
const Trooba = require('trooba');
// config is used to configure transport and hystrix handler

const pipe = Trooba
// set config parameters
.use(require('trooba-hystrix-handler'), {
    command: 'my-service-command', // required
    timeout: 2000,  // optional
    circuitBreakerErrorThresholdPercentage: 50, // optional
    circuitBreakerForceClosed: false, // optional
    circuitBreakerForceOpened: false, // optional
    circuitBreakerRequestVolumeThreshold: 20, // optional
    circuitBreakerSleepWindowInMilliseconds: 5000, // optional
    requestVolumeRejectionThreshold: 0, // optional
    statisticalWindowNumberOfBuckets: 10, // optional
    statisticalWindowLength: 10000, // optional
    percentileWindowNumberOfBuckets: 6, // optional
    percentileWindowLength: 60000 // optional
})
// add http transport
.use(require('trooba-http-transport'), {
    hostname: 'localhost',
    port: 8000
})
.build({
    fallback: (err, request) => {  // optional
        console.log(request); // will print {foo:'bar'}
        return Promise.resolve('fallback');
    }
});

pipe.create().request({
    foo: 'bar'
}, (err, response) => console.log(err, response));
```

#### Viewing metrics using Hystrix dashboard

In case an application and [hystrix-dashboard](https://github.com/dimichgh/hystrix-dashboard) are packaged together, one can expose hystrix.stream as one of the http commands.

```js
const express = require('express');
const app = express();
const dashboard = require('hystrix-dashboard');

app.use(dashboard({
    // configurable hystrix metrics topic that trooba hystrix handler uses to publish data
    topic: 'trooba:hystrix:data'
}));

app.listen(8000); //  http://localhost:8080/hystrix.stream
```
