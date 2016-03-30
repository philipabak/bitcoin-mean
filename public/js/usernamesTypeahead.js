(function () {
  'use strict';

  var MIN_CACHE = 5;

  function UserTypeaheadSearcher() {
    this.queryCache = [];
    this.lastQuery = '';
  }

  function escapeRegExp(string){
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  UserTypeaheadSearcher.prototype.suggestions = function(query, syncResults, asyncResults) {

    //The new query is an increment of the old query
    if(query.match("^"+escapeRegExp(this.lastQuery))) {

      //Remove not matching local results
      var regex = new RegExp('^'+escapeRegExp(query));
      for(var i = 0, length = this.queryCache.length; i < length; i++) {
        if(!regex.test(this.queryCache[i])) {
          this.queryCache.splice(i, 1);
          i--;
          length--;
        }
      }

      if(this.queryCache.length < MIN_CACHE)
        this.getMoreUsernames(query, asyncResults);
      else
        syncResults(this.queryCache);

      //Its a new query so we need new elements
    } else {
      this.queryCache = [];
      this.getMoreUsernames(query, asyncResults);
    }

    this.lastQuery = query;
  };

  UserTypeaheadSearcher.prototype.getMoreUsernames = function(query, cb) {
    var self = this;

    $.ajax({
      url: '/api/usernames/'+encodeURIComponent(query),
      type: 'GET',
      success: function(json) {
        var unames = JSON.parse(json);
        if(!unames)
          unames = [];

        self.queryCache = unames;
        cb(unames)
      }
    })
  };

  UserTypeaheadSearcher.prototype.mount = function(nodeId) {

    $(nodeId).typeahead({//Options
      // The hint appears in (modifies) the input field value. We want users to
      // deliberately click a uname or type it out fully.
      hint: false,
      highlight: true,
      minLength: 2
    }, { //Data set 1
      name: 'unames',
      source: this.suggestions.bind(this)
    });
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = UserTypeaheadSearcher;
  } else if (typeof define === 'function' && typeof define.amd === 'object' && define.amd){
    // AMD. Register as an anonymous module.
    define(function () {
      return UserTypeaheadSearcher;
    });
  } else {
    window.UserTypeaheadSearcher = UserTypeaheadSearcher;
  }

}());