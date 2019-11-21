## regtest network

To get started with unit tests you need to startup the sandboxed bitcoin regtest network described in `docker-compose.yml`.  This will creates a network with a single bitcoin node for use in .

Start the test network:
```
$ cd regtest
$ docker-compose up -d
$ docker logs -f regtest_bitcoind_1
```

Run the unit tests:

```
$ npm test
```



### Creating Unit Tests

Take a look at the tests in the `test` directory for guidance on how to create unit tests.

