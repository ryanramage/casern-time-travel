const _ = require('lodash')
const vorpal = require('vorpal')()
const ddoc = require('./_design-timetravel')

module.exports = (config, statedb, reducers) => {
  let stateId = null
  let currentIndex = 0

  vorpal.command('prepare', 'prepare the db').action((args, cb) => {
    statedb.put(ddoc, (err, resp) => {
      if (err) {
        vorpal.log(err)
        cb()
      }
      vorpal.log(resp)
      cb()
    })
  })
  vorpal.command('list', 'list stateIds available').action((args, cb) => {
    statedb.query('timetravel/by_active', (err, resp) => {
      if (err) {
        vorpal.log(err)
        cb()
      }
      let ids = _.get(resp, 'rows', []).map(r => r.key)
      vorpal.log(ids)
      cb()
    })
  })
  vorpal.command('inspect <stateId>', 'start inspected a state').action((args, cb) => {
    stateId = args.stateId
    vorpal.log(`now inspecting state: ${stateId}`)
    cb()
  })

  vorpal.command('now', 'Go to the most recent state').action((args, cb) => {
    if (!stateId) {
      vorpal.log('no stateId to inspect. use "inspect <stateId>"')
      return cb()
    }
    currentIndex = 0
    show(config, statedb, stateId, currentIndex, cb)
  })

  vorpal.command('prev', 'Go to the prev state').action((args, cb) => {
    if (!stateId) {
      vorpal.log('no stateId to inspect. use "inspect <stateId>"')
      return cb()
    }
    currentIndex = currentIndex + 1
    show(config, statedb, stateId, currentIndex, cb)
  })

  vorpal.command('next', 'Go to the prev state').action((args, cb) => {
    if (!stateId) {
      vorpal.log('no stateId to inspect. use "inspect <stateId>"')
      return cb()
    }
    if (!currentIndex) {
      vorpal.log('at most recent state')
      return cb()
    }
    currentIndex = currentIndex - 1
    show(config, statedb, stateId, currentIndex, cb)
  })

  vorpal.command('reducers', 'list the reducers available').action((args, cb) => {
    let names = Object.keys(reducers)
    vorpal.log(JSON.stringify(names))
    cb()
  })

  vorpal.command('run', 'run the reducer with the data and generate the next state')
    .option('-r --reducer <reducer>', 'choose the reducer to run')
    .option('-d --data <data>', 'data to use instead of the stored data')
    .option('-f --file <filename>', 'fileame of data to use instead of the stored data')
    .action((args, cb) => run(config, statedb, reducers, stateId, currentIndex, args, cb))

  vorpal.delimiter('passenger$').show()
}

function run (config, statedb, reducers, stateId, currentIndex, args, cb) {
  get(statedb, stateId, currentIndex, (err, { state, id }) => {
    if (err) {
      vorpal.log(err)
      return cb()
    }
    let options = args.options
    if (options.data) {
      try {
        let data = JSON.parse(options.data)
        if (!options.reducer) {
          vorpal.log('a reducer must be specified with the data option')
          return cb()
        }
        return afterData(config, reducers, id, state, data, options.reducer, null, null, cb)
      } catch (e) {
        vorpal.log(e)
        return cb()
      }
    }
    if (options.file) {
      try {
        let data = require(options.file)
        if (!options.reducer) {
          vorpal.log('a reducer must be specified with the file option')
          return cb()
        }
        return afterData(config, reducers, id, state, data, options.reducer, null, null, cb)
      } catch (e) {
        vorpal.log(e)
        return cb()
      }
    }
    getData(statedb, stateId, currentIndex, (err, resp) => {
      if (err) {
        vorpal.log(err.message)
        return cb()
      }
      let _target = resp.target || options.reducer
      afterData(config, reducers, id, state, resp.data, _target, resp.nextStateId, resp.nextState, cb)
    })
  })
}

function afterData (config, reducers, id, state, data, target, nextStateId, nextState, cb) {
  let reducer = reducers[target]
  if (!reducer) {
    vorpal.log('reducer does not exist')
    return cb()
  }
  try {
    let nextStateComputed = reducer(config, state, data)
    vorpal.log('\n')
    vorpal.log('start state ----------')
    vorpal.log(`stateId: ${id}`)
    printDate(id)
    vorpal.log(JSON.stringify(state))
    vorpal.log('\n')
    vorpal.log('applied data ---------')
    vorpal.log(JSON.stringify(data))
    vorpal.log('\n')

    vorpal.log('result ---------------')
    vorpal.log(JSON.stringify(nextStateComputed))
    vorpal.log('\n')

    if (nextStateId) {
      vorpal.log('db state -------------')
      vorpal.log(`stateId ${nextStateId}`)
      printDate(nextStateId)
      vorpal.log(JSON.stringify(nextState))
      vorpal.log('\n')
    }
    cb()
  } catch (e) {
    vorpal.log(e)
    cb()
  }
}

function show (config, statedb, stateId, currentIndex, cb) {
  get(statedb, stateId, currentIndex, (err, resp) => {
    if (err) return vorpal.log(err)
    vorpal.log('\n')
    vorpal.log(`stateId: ${resp.id}`)
    printDate(resp.id)
    vorpal.log(JSON.stringify(resp.state))
    vorpal.log('\n')
    cb()
  })
}

function get (statedb, stateId, currentIndex, cb) {
  let _q = baseQuery(stateId, currentIndex)
  _q.skip = currentIndex
  _q.limit = 1
  statedb.allDocs(_q, (err, resp) => {
    if (err) return cb(err)
    let id = _.get(resp, 'rows[0].id')
    let state = _.get(resp, 'rows[0].doc.state', null)
    cb(null, { id, state })
  })
}

function getData (statedb, stateId, currentIndex, cb) {
  let _q = baseQuery(stateId, currentIndex)
  _q.skip = currentIndex - 1
  if (_q.skip < 0) return cb(new Error('no data'))
  _q.limit = 1
  statedb.allDocs(_q, (err, resp) => {
    if (err) return cb(err)
    let data = _.get(resp, 'rows[0].doc.data')
    let target = _.get(resp, 'rows[0].doc.target')
    let nextState = _.get(resp, 'rows[0].doc.state')
    let nextStateId = _.get(resp, 'rows[0].id')
    if (!data) return cb(new Error('no data to apply'))
    cb(null, { data, target, nextState, nextStateId })
  })
}

function baseQuery (stateId, currentIndex) {
  let q = {
    start_key: `${stateId}|${Number.MAX_SAFE_INTEGER}`,
    end_key: `${stateId}`,
    descending: true,
    include_docs: true
  }
  return q
}

function printDate (_id) {
  let d = Number(_id.split('|').pop())
  console.log(d)
  let dt = new Date(d).toString()
  vorpal.log(dt)
}
