trooba-hystrix-handler
======================

Trooba handler that provides Hystrix functionality to [trooba](https://github.com/trooba/trooba) based service pipelines.


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
const config = {
    hostname: 'localhost',
    port: 8000
};

const pipe = Trooba
// set optional config parameters
.use(require('trooba-hystrix-handler'), {
    command: 'my-service-command',
    timeout: 2000,
    circuitBreakerErrorThresholdPercentage: 50,
    circuitBreakerForceClosed: false,
    circuitBreakerForceOpened: false,
    circuitBreakerRequestVolumeThreshold: 20,
    circuitBreakerSleepWindowInMilliseconds: 5000,
    requestVolumeRejectionThreshold: 0,
    statisticalWindowNumberOfBuckets: 10,
    statisticalWindowLength: 10000,
    percentileWindowNumberOfBuckets: 6,
    percentileWindowLength: 60000
})
// add http transport
.use(require('trooba-http-transport'), config)
.build();

pipe.create().request({
    foo: 'bar'
}, (err, response) => console.log(err, response));
```

### Publishing metrics

In order to consume the metrics one needs to subscribe to the process event stream and push it outside via sse stream  or to any other data storage. Please see examples on how this can be done below.

```js
process.on('trooba:hystrix:data', data => console.log(data));
```

### Viewing metrics using Hystrix dashboard

#### Standalone

One can use a standard [hystrix dashboard](https://github.com/Netflix/Hystrix/tree/master/hystrix-dashboard) to view metrics exported as an sse stream.

Here's how expose sse stream in your application

```js
const express = require('express');
const app = express();
// configurable hystrix metrics topic that trooba hystrix handler uses
const topic = 'trooba:hystrix:data';
app.use('/hystrix.stream', function hystrixStreamResponse(request, response) {
    response.append('Content-Type', 'text/event-stream;charset=UTF-8');
    response.append('Cache-Control', 'no-cache, no-store, max-age=0, must-revalidate');
    response.append('Pragma', 'no-cache');

    const listener = data => {
        if (typeof data !== 'string') {
            data = JSON.stringify(data);
        }
        response.write('data: ' + data + '\n\n');
    };

    process.on(topic, listener);

    const cleanAll = () => process.removeListener(topic, listener);

    request.once('close', cleanAll);
    request.once('aborted', cleanAll);
    response.once('close', cleanAll);
    response.once('finish', cleanAll);
});
```

#### Within the same runtime

In case an application and [hystrix-dashboard](https://github.com/dimichgh/hystrix-dashboard) are packaged together, one can expose hystrix.stream as one of the http commands.

```js
const express = require('express');
const app = express();
const dashboard = require('hystrix-dashboard');

app.use(dashboard({
    topic: 'trooba:hystrix:data' // <<< configurable hystrix metrics topic that trooba hystrix handler uses
}));

app.listen(8000); //  http://localhost:8080/hystrix
```
# trooba-hystrix-handler
