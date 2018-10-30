var ddoc = {
  _id: '_design/timetravel',
  views: {}
}

ddoc.views.by_active = {
  map: function (doc) {
    if (doc.stale) return
    // remove the timestamp from the doc id
    var parts = doc._id.split('|')
    parts.splice(-1)
    var id = parts.join('|')
    emit(id, null) // eslint-disable-line
  }.toString()
}

module.exports = ddoc
