/**
 * API Bound Models for AngularJS
 * @version v0.8.1 - 2013-12-09
 * @link https://github.com/angular-platanus/restmod
 * @author Ignacio Baixas <iobaixas@gmai.com>
 * @license MIT License, http://www.opensource.org/licenses/MIT
 */

(function(angular, undefined) {
'use strict';
/**
 * @namespace constants
 *
 * @description Constants and utilities exposed by the library.
 */

/**
 * @namespace providers
 *
 * @description Angular providers provided by the library.
 */

/**
 * @namespace services
 *
 * @description Angular services provided by the library.
 */

angular.module('plRestmod', ['ng', 'platanus.inflector']);

/**
 * @class Utils
 * @memberOf constants
 *
 * @description Various utilities used across
 * the library
 *
 * This utilities are available as the `Utils` constant when restmod is included.
 */
var Utils = {
  /**
   * @memberof constants.Utils
   *
   * @description Chains to filtering functions together
   *
   * @param  {function} _first original function
   * @param  {function} _fun   function to call on the original function result
   * @return {mixed}        value returned by the last function call
   */
  chain: function(_first, _fun) {
    if(!_first) return _fun;
    return function(_value) {
      return _fun.call(this, _first.call(this, _value));
    };
  },
  /**
   * @memberof constants.Utils
   *
   * @description Override a property value, making overriden function available as this.$super
   *
   * @param  {function} _super Original value
   * @param  {mixed} _fun New property value
   * @return {mixed} Value returned by new function
   */
  override: function(_super, _fun) {
    if(!_super || typeof _fun !== 'function') return _fun;

    return function() {
      var oldSuper = this.$super;
      try {
        this.$super = _super;
        return _fun.apply(this, arguments);
      } finally {
        this.$super = oldSuper;
      }
    };
  },
  /**
   * @memberof constants.Utils
   *
   * @description Extend an object using `Utils.override` instead of just replacing the functions.
   *
   * @param  {object} _target Object to be extended
   * @param  {object} _other  Source object
   */
  extendOverriden: function(_target, _other) {
    for(var key in _other) {
      if(_other.hasOwnProperty(key)) {
        _target[key] = Utils.override(_target[key], _other[key]);
      }
    }
  }
};

// make this available as a restmod constant
angular.module('plRestmod').constant('Utils', Utils);

/*
 *
 */

/**
 * @class SyncMask
 * @memberOf constants
 *
 * @description The object property synchronization mask.
 */
var SyncMask = {
  NONE: 0x00,
  ALL: 0xFFFF,
  SYSTEM_ALL: 0x1FFFF,

  SYSTEM: 0x10000,

  DECODE_CREATE: 0x0001,
  DECODE_UPDATE: 0x0002,
  DECODE_USER: 0x0004,
  DECODE_SAVE: 0x0003,

  ENCODE_CREATE: 0x0100,
  ENCODE_UPDATE: 0x0200,
  ENCODE_USER: 0x0400,
  ENCODE_SAVE: 0x0300,

  // Compound masks
  DECODE: 0x00FF,
  ENCODE: 0xFF00,
  CREATE: 0x0101,
  UPDATE: 0x0202,
  USER: 0x0404,
  SAVE: 0x0303
};

// Cache some angular stuff
var bind = angular.bind,
    forEach = angular.forEach,
    extend = angular.extend,
    isObject = angular.isObject,
    isArray = angular.isArray,
    isFunction = angular.isFunction,
    arraySlice = Array.prototype.slice;

/**
 * @class $restmodProvider
 * @memberOf providers
 *
 * @description
 *
 * The $restmodProvider exposes $restmod configuration methods
 */
angular.module('plRestmod').provider('$restmod', function() {

  var BASE_CHAIN = []; // The base mixin chain

  return {
    /**
     * @memberof providers.$restmodProvider
     *
     * @description
     * Adds mixins to the base model chain.
     *
     * Non abstract models should NOT be added to this chain.
     *
     * Base model chain is by default empty, all mixins added to the chain are
     * prepended to every generated model.
     *
     * Usage:
     *
     * ```javascript
     * $provider.pushModelBase('ChangeModel', 'LazyRelations', 'ThrottledModel')
     * ```
     */
    pushModelBase: function(/* mixins */) {
      Array.prototype.push.apply(BASE_CHAIN, arguments);
      return this;
    },

    /**
     * @class $restmod
     * @memberOf services
     *
     * @description The restmod service provides the `model` and `mixin` factories.
     */
    $get: ['$http', '$q', '$injector', '$parse', '$filter', '$inflector', function($http, $q, $injector, $parse, $filter, $inflector) {

      return {
        /**
         * @function model
         * @memberOf services.$restmod#
         *
         * @description
         *
         * The model factory is used to generate mode types using a rich building DSL provided
         * by the {@link restmod.class:ModelBuilder ModelBuilder}.
         *
         * For more information about model generation see {@link Building a Model}
         */
        model: function(_urlParams/* , _mix */) {

          var masks = {
                $partial: SyncMask.SYSTEM_ALL,
                $context: SyncMask.SYSTEM_ALL,
                $promise: SyncMask.SYSTEM_ALL,
                $pending: SyncMask.SYSTEM_ALL,
                $response: SyncMask.SYSTEM_ALL,
                $error: SyncMask.SYSTEM_ALL
              },
              defaults = [],
              decoders = {},
              encoders = {},
              callbacks = {},
              nameDecoder = $inflector.camelize,
              nameEncoder = function(_v) { return $inflector.parameterize(_v, '_'); },
              urlBuilder;

          // runs all callbacks associated with a given hook.
          function callback(_hook, _ctx /*, args */) {
            var cbs = callbacks[_hook];
            if(cbs) {
              var i = 0, args = arraySlice.call(arguments, 2), cb;
              while((cb = cbs[i++])) {
                // execute callback
                cb.apply(_ctx, args);
              }
            }
          }

          // common http behavior, used both in collections and model instances.
          function send(_target, _config, _success, _error) {

            callback('before-request', _target, _config);

            _target.$pending = true;
            _target.$response = null;
            _target.$error = false;

            _target.$promise = $http(_config).then(function(_response) {

              // IDEA: a response interceptor could add additional error states based on returned data,
              // this could allow for additional error state behaviours (for example, an interceptor
              // could watch for rails validation errors and store them in the model, then return false
              // to trigger a promise queue error).

              _target.$pending = false;
              _target.$response = _response;

              callback('after-request', _target, _response);

              if(_success) _success.call(_target, _response);

              return _target;

            }, function(_response) {

              _target.$pending = false;
              _target.$response = _response;
              _target.$error = true;

              callback('after-request-error', _target, _response);

              if(_error) _error.call(_target, _response);

              return $q.reject(_target);
            });
          }

          // recursive transformation function, used by $decode and $encode.
          function transform(_data, _ctx, _prefix, _mask, _decode, _into) {

            var key, decodedName, encodedName, fullName, filter, value, result = _into || {};

            for(key in _data) {
              if(_data.hasOwnProperty(key)) {

                decodedName = (_decode && nameDecoder) ? nameDecoder(key) : key;
                fullName = _prefix + decodedName;

                // check if property is masked for this operation
                if(!((masks[fullName] || 0) & _mask)) {

                  value = _data[key];
                  filter = _decode ? decoders[fullName] : encoders[fullName];

                  if(filter) {
                    value = filter.call(_ctx, value);
                    if(value === undefined) continue; // ignore value if filter returns undefined
                  } else if(typeof value === 'object' && value &&
                    (_decode || typeof value.toJSON !== 'function')) {
                    // IDEA: make extended decoding/encoding optional, could be a little taxxing for some apps
                    value = transformExtended(value, _ctx, fullName, _mask, _decode);
                  }

                  encodedName = (!_decode && nameEncoder) ? nameEncoder(decodedName) : decodedName;
                  result[encodedName] = value;
                }
              }
            }

            return result;
          }

          // extended part of transformation function, enables deep object transform.
          function transformExtended(_data, _ctx, _prefix, _mask, _decode) {
            if(isArray(_data))
            {
              var fullName = _prefix + '[]',
                  filter = _decode ? decoders[fullName] : encoders[fullName],
                  result = [], i, l, value;

              for(i = 0, l = _data.length; i < l; i++) {
                value = _data[i];
                if(filter) {
                  value = filter.call(_ctx, value);
                } else if(typeof value === 'object' && value &&
                  (_decode || typeof value.toJSON !== 'function')) {
                  value = transformExtended(value, _ctx, _prefix, _mask, _decode);
                }
                result.push(value);
              }

              return result;
            } else {
              return transform(_data, _ctx, _prefix + '.', _mask, _decode);
            }
          }

          /**
           * @class Model
           *
           * @property {string} $partial The model partial url, relative to the context.
           * @property {ModelCollection|Model} $context The model context (parent).
           * @property {promise} $promise The last request promise, returns the model.
           * @property {boolean} $pending The last request status.
           * @property {string} $error The last request error, if any.
           *
           * @description
           *
           * The base model type, this is the starting point for every model generated by $restmod.
           *
           * Inherits all static methods from {@link ModelCollection}.
           *
           * #### About object creation
           *
           * Direct construction of object instances using `new` is not recommended. A collection of
           * static methods are available to generate new instances of an model, for more information
           * go check the {@link ModelCollection} documentation.
           */
          var Model = function(_init, _url, _context) {

            this.$pending = false;
            this.$partial = _url;
            this.$context = _context;

            var tmp;

            // apply defaults
            for(var i = 0; (tmp = defaults[i]); i++) {
              this[tmp[0]] = (typeof tmp[1] === 'function') ? tmp[1].apply(this) : tmp[1];
            }

            if(_init) {
              // copy initial values (if given)
              for(tmp in _init) {
                if (_init.hasOwnProperty(tmp)) {
                  this[tmp] = _init[tmp];
                }
              }
            }
          };

          // TODO: type reflection methods
          // Model.$ignored
          // Model.$relation

          Model.prototype = {
            /**
             * @memberof Model#
             *
             * @description Returns the url this object is bound to.
             *
             * @param {object} _opt Options to be passed to the url builder.
             * @return {string} bound url.
             */
            $url: function(_opt) {
              return urlBuilder.resourceUrl(this, _opt);
            },

            /**
             * @memberof Model#
             *
             * @description Iterates over the object properties
             *
             * @param {function} _fun Function to call for each
             * @param {SyncMask} _mask Mask used to filter the returned properties, defaults to SyncMask.SYSTEM
             * @return {Model} self
             */
            $each: function(_fun, _mask, _ctx) {
              if(_mask === undefined) _mask = SyncMask.SYSTEM;

              for(var key in this) {
                if(this.hasOwnProperty(key)) {
                  // Only iterate at base level for now
                  if(!((masks[key] || 0) & _mask)) {
                    _fun.call(_ctx || this[key], this[key], key);
                  }
                }
              }

              return this;
            },

            /**
             * @memberof Model#
             *
             * @description Allows calling custom hooks, usefull when implementing custom actions.
             *
             * Passes through every additional arguments to registered hooks.
             * Hooks are registered using the ModelBuilder.on method.
             *
             * @param {string} _hook hook name
             * @return {Model} self
             */
            $callback: function(_hook /*, args */) {
              callback(this, _hook, arraySlice.call(arguments, 1));
              return this;
            },

            /**
             * @memberof Model#
             *
             * @description Low level communication method, wraps the $http api.
             *
             * @param {object} _options $http options
             * @param {function} _success sucess callback (sync)
             * @param {function} _error error callback (sync)
             * @return {Model} self
             */
            $send: function(_options, _success, _error) {
              send(this, _options, _success, _error);
              return this;
            },

            /**
             * @memberof Model#
             *
             * @description Promise chaining method, keeps the model instance as the chain context.
             *
             * Calls `$q.then` on the model's last promise.
             *
             * Usage:
             *
             * ```javascript
             * col.$fetch().$then(function() { });
             * ```
             *
             * @param {function} _success success callback
             * @param {function} _error error callback
             * @return {Model} self
             */
            $then: function(_success, _error) {
              this.$promise = this.$promise.then(_success, _error);
              return this;
            },

            /**
             * @memberof Model#
             *
             * @description Promise chaining, keeps the model instance as the chain context.
             *
             * Calls ´$q.finally´ on the collection's last promise, updates last promise with finally result.
             *
             * Usage:
             *
             * ```javascript
             * col.$fetch().$finally(function() { });
             * ```
             *
             * @param {function} _cb callback
             * @return {Model} self
             */
            $finally: function(_cb) {
              this.$promise = this.$promise['finally'](_cb);
              return this;
            },

            /**
             * @memberof Model#
             *
             * @description Feed raw data to this instance.
             *
             * @param {object} _raw Raw data to be fed
             * @param {string} _mask Action mask
             * @return {Model} this
             */
            $decode: function(_raw, _mask) {
              transform(_raw, this, '', _mask || SyncMask.DECODE_USER, true, this);
              callback('after-feed', this, _raw);
              return this;
            },

            /**
             * @memberof Model#
             *
             * @description Generate data to be sent to the server when creating/updating the resource.
             *
             * @param {string} _action Action that originated the render
             * @return {Model} this
             */
            $encode: function(_mask) {
              var raw = transform(this, this, '', _mask || SyncMask.ENCODE_USER, false);
              callback('before-render', this, raw);
              return raw;
            },

            /**
             * @memberof Model#
             *
             * @description Begin a server request for updated resource data.
             *
             * The request's promise is provided as the $promise property.
             *
             * @return {Model} this
             */
            $fetch: function() {
              // verify that instance has a bound url
              if(!this.$url()) throw new Error('Cannot fetch an unbound resource');

              var request = { method: 'GET', url: this.$url() };

              callback('before-fetch', this, request);
              return this.$send(request, function(_response) {

                var data = _response.data;
                if (!data || isArray(data)) {
                  throw new Error('Expected object while feeding resource');
                }
                this.$decode(data);

                callback('after-fetch', this, _response );
              }, function(_response) {
                callback('after-fetch-error', this, _response );
              });
            },

            /**
             * @memberof Model#
             *
             * @description Begin a server request to create/update resource.
             *
             * The request's promise is provided as the $promise property.
             *
             * @return {Model} this
             */
            $save: function() {
              var url, request;

              if(this.$url()) {
                // If bound, update

                url = urlBuilder.updateUrl(this);
                if(!url) throw new Error('Update is not supported by this resource');

                request = { method: 'PUT', url: url, data: this.$encode(SyncMask.ENCODE_UPDATE) };

                callback('before-update', this, request);
                callback('before-save', this, request);
                return this.$send(request, function(_response) {
                  var data = _response.data;
                  if (data && !isArray(data)) this.$decode(data, SyncMask.DECODE_UPDATE);
                  callback('after-update', this, _response);
                  callback('after-save', this, _response);
                }, function(_response) {
                  callback('after-update-error', this, _response);
                  callback('after-save-error', this, _response);
                });
              } else {
                // If not bound create.

                url = urlBuilder.createUrl(this);
                if(!url) throw new Error('Create is not supported by this resource');

                request = { method: 'POST', url: url, data: this.$encode(SyncMask.ENCODE_CREATE) };

                callback('before-save', this, request);
                callback('before-create', this, request);
                return this.$send(request, function(_response) {
                  var data = _response.data;
                  if (data && !isArray(data)) this.$decode(data, SyncMask.DECODE_CREATE);
                  callback('after-create', this, _response);
                  callback('after-save', this, _response);
                }, function(_response) {
                  callback('after-create-error', this, _response);
                  callback('after-save-error', this, _response);
                });
              }
            },

            /**
             * @memberof Model#
             *
             * @description Begin a server request to destroy the resource.
             *
             * The request's promise is provided as the $promise property.
             *
             * @return {Model} this
             */
            $destroy: function() {
              var url = urlBuilder.destroyUrl(this);
              if(!url) throw new Error('Destroy is not supported by this resource');

              var request = { method: 'DELETE', url: url };

              callback('before-destroy', this, request);
              return this.$send(request, function(_response) {
                callback('after-destroy', this, _response);
              }, function(_response) {
                callback('after-destroy-error', this, _response);
              });
            }
          };

          /**
           * @class ModelCollection
           *
           * @description
           *
           * Collections are sets of model instances bound to a given api resource. When a model
           * class is generated, the corresponding collection class is also generated.
           */
          var Collection = {
            /**
             * @memberof ModelCollection#
             *
             * @description Returns the url this collection is bound to.
             *
             * @param {object} _opt Options to be passed to the url builder.
             * @return {string} bound url.
             */
            $url: function(_opt) {
              return urlBuilder.collectionUrl(this, _opt);
            },

            /**
             * @memberof ModelCollection#
             *
             * @description Builds a new instance of this model
             *
             * If `_init` is not an object, then its treated as a primary key.
             *
             * @param  {object} _init Initial values
             * @return {Model} model instance
             */
            $build: function(_init) {
              var init, keyName;
              if(!isObject(_init)) {
                init = {};
                keyName = urlBuilder.inferKey(this);
                if(!keyName) throw new Error('Cannot infer key, use explicit mode');
                init[keyName] = _init;
              } else init = _init;

              var obj = new Model(init, null, this);
              if(this.$isCollection) this.push(obj); // on collection, push new object
              return obj;
            },

            /**
             * @memberof ModelCollection#
             *
             * @description Builds a new instance of this model using undecoded data
             *
             * @param  {object} _raw Undecoded data
             * @return {Model} model instance
             */
            $buildRaw: function(_raw) {
              return this.$build(null).$decode(_raw);
            },

            /**
             * @memberof ModelCollection#
             *
             * @description Builds and saves a new instance of this model
             *
             * @param  {object} _attr Data to be saved
             * @return {Model} model instance
             */
            $create: function(_attr) {
              return this.$build(_attr).$save();
            },

            /**
             * @memberof ModelCollection#
             *
             * @description Attempts to resolve a resource using provided data
             *
             * If `_init` is not an object, then its treated as a primary key.
             *
             * @param  {object} _init Data to provide
             * @return {Model} model instance
             */
            $find: function(_init) {
              var init, keyName;
              if(!isObject(_init)) {
                init = {};
                keyName = urlBuilder.inferKey(this);
                if(!keyName) throw new Error('Cannot infer key, use explicit mode');
                init[keyName] = _init;
              } else init = _init;

              // dont use $build, find does not push into current collection.
              return (new Model(init, null, this)).$fetch();
            },

            /**
             * @memberof ModelCollection#
             *
             * @description Builds a new Model collection
             *
             * Collections are bound to an api resource.
             *
             * @param  {object} _params  Additional query string parameters
             * @param  {string} _url     Optional collection URL (relative to context)
             * @param  {object} _context Collection context override
             * @return {Collection} Model Collection
             */
            $collection: function(_params, _url, _context) {

              _params = this.$params ? extend({}, this.$params, _params) : _params;

              var col = [];

              // Since Array cannot be extended, use method injection
              // TODO: try to find a faster alternative, use for loop instead for example.
              for(var key in Collection) {
                if(this.hasOwnProperty(key)) col[key] = this[key];
              }

              col.$partial = _url || this.$partial;
              col.$context = _context || this.$context;
              col.$isCollection = true;
              col.$params = _params;
              col.$pending = false;
              col.$resolved = false;

              return col;
            },

            /**
             * @memberof ModelCollection#
             *
             * @description Generates a new collection bound to this context and url and calls $fetch on it.
             *
             * @param {object} _params Collection parameters
             * @return {Collection} Model collection
             */
            $search: function(_params) {
              return this.$collection(_params).$fetch();
            },

            // Collection exclusive methods

            /**
             * @memberof ModelCollection#
             *
             * @description Promise chaining method, keeps the collection instance as the chain context.
             *
             * Calls `$q.then` on the collection's last promise.
             *
             * Usage:
             *
             * ```javascript
             * col.$fetch().$then(function() { });
             * ```
             *
             * @param {function} _success success callback
             * @param {function} _error error callback
             * @return {ModelCollection} self
             */
            $then: function(_success, _error) {
              if(!this.$isCollection) throw new Error('$then is only supported by collections');
              this.$promise = this.$promise.then(_success, _error);
              return this;
            },

            /**
             * @memberof ModelCollection#
             *
             * @description Promise chaining, keeps the collection instance as the chain context.
             *
             * Calls ´$q.finally´ on the collection's last promise, updates last promise with finally result.
             *
             * Usage:
             *
             * ```javascript
             * col.$fetch().$finally(function() { });
             * ```
             *
             * @param {function} _cb callback
             * @return {ModelCollection} self
             */
            $finally: function(_cb) {
              this.$promise = this.$promise['finally'](_cb);
              return this;
            },

            /**
             * @memberof ModelCollection#
             *
             * @description Feeds raw collection data into the collection, marks collection as $resolved
             *
             * This method is for use in collections only.
             *
             * @param {array} _raw Data to add
             * @return {Collection} self
             */
            $feed: function(_raw) {
              if(!this.$isCollection) throw new Error('$feed is only supported by collections');
              if(!this.$resolved) this.length = 0; // reset contents if not resolved.
              forEach(_raw, this.$buildRaw, this);
              this.$resolved = true;
              return this;
            },

            /**
             * @memberof ModelCollection#
             *
             * @description Resets the collection's resolve status.
             *
             * This method is for use in collections only.
             *
             * @return {Collection} self
             */
            $reset: function() {
              if(!this.$isCollection) throw new Error('$reset is only supported by collections');
              this.$resolved = false;
              return this;
            },

            /**
             * @memberof ModelCollection#
             *
             * @description Begin a server request to populate collection. This method does not
             * clear the collection contents, use `$refresh` to reset and fetch.
             *
             * This method is for use in collections only.
             *
             * TODO: support POST data queries (complex queries scenarios)
             *
             * @param {object} _params Additional request parameters, these parameters are not stored in collection.
             * @return {Collection} self
             */
            $fetch: function(_params) {

              if(!this.$isCollection) throw new Error('$fetch is only supported by collections');

              var params = _params ? extend({}, this.$params || {}, _params) : this.$params,
                  request = { method: 'GET', url: this.$url(), params: params };

              // TODO: check that collection is bound.
              callback('before-fetch-many', this, request);
              send(this, request, function(_response) {
                var data = _response.data;
                if(!data || !isArray(data)) {
                  throw new Error('Error in resource {0} configuration. Expected response to be array');
                }
                this.$feed(data); // feed retrieved data.
                callback('after-fetch-many', this, _response);
              }, function(_response) {
                callback('after-fetch-many-error', this, _response);
              });

              return this;
            },

            /**
             * @memberof ModelCollection#
             *
             * @description Resets and fetches content.
             *
             * @param  {object} _params `$fetch` params
             * @return {Collection} self
             */
            $refresh: function(_params) {
              return this.$reset().$fetch(_params);
            }

            // IDEA: $clear, $push, $remove, etc
          };

          // Model customization phase:
          // - Generate the model builder DSL
          // - Process metadata from base chain
          // - Process metadata from arguments

          // Available mappings.
          var mappings = {
            init: ['attrDefault'],
            mask: ['attrMask'],
            ignore: ['attrMask'],
            decode: ['attrDecoder', 'param', 'chain'],
            encode: ['attrEncoder', 'param', 'chain'],
            serialize: ['attrSerializer'],
            hasMany: ['hasMany', 'alias'],
            hasOne: ['hasOne', 'alias']
          }, urlBuilderFactory;

          /**
           * @class ModelBuilder
           *
           * @description
           *
           * Provides the DSL for model generation.
           *
           * ### About model descriptions
           *
           * This class is also responsible for parsing **model description objects** passed to
           * the mixin chain.
           *
           * Example of description:
           *
           * ```javascript
           * $restmod.model('', {
           *   propWithDefault: { init: 20 },
           *   propWithDecoder: { decode: 'date', chain: true },
           *   relation: { hasMany: 'Other' },
           * });
           * ```
           *
           * The descriptions are processed by the `describe` method and mapped to builder attribute methods.
           *
           * The following built in property modifiers are provided (see each method docs for usage information):
           *
           * * `init` maps to {@link ModelBuilder#attrDefault}
           * * `mask` and `ignore` maps to {@link ModelBuilder#attrMask}
           * * `decode` maps to {@link ModelBuilder#attrDecoder}
           * * `encode` maps to {@link ModelBuilder#attrEncoder}
           * * `serialize` maps to {@link ModelBuilder#attrSerializer}
           * * `hasMany` maps to {@link ModelBuilder#hasMany}
           * * `hasOne` maps to {@link ModelBuilder#hasOne}
           *
           * Mapping a *primitive* to a property is the same as using the `init` modifier.
           * Mapping a *function* to a property calls {@link ModelBuilder#define} on the function.
           *
           */
          var Builder = {
            setHttpOptions: function(_options) {
              // TODO.
            },

            /**
             * @memberof ModelBuilder#
             *
             * @description Change the default url builder.
             *
             * The provided factory will be called to provide an url builder
             * for  implement a `get` method that receives the resource baseUrl
             * and returns an url builder.
             *
             * TODO: describe url builder interface
             *
             * @param {function} _factory Url builder factory function.
             */
            setUrlBuilderFactory: function(_factory) {
              urlBuilderFactory = _factory;
              return this;
            },

            /**
             * @memberof ModelBuilder#
             *
             * @description Changes the way restmod renames attributes every time a server resource is decoded.
             *
             * This is intended to be used as a way of keeping property naming style consistent accross
             * languajes. By default, property naming in js should use camelcase and property naming
             * in JSON api should use snake case with underscores.
             *
             * If `false` is given, then renaming is disabled
             *
             * @param {function|false} _value decoding function
             * @return {ModelBuilder} self
             */
            setNameDecoder: function(_decoder) {
              nameDecoder = _decoder;
              return this;
            },

            /**
             * @memberof ModelBuilder#
             *
             * @description Changes the way restmod renames attributes every time a local resource is encoded to be sent.
             *
             * This is intended to be used as a way of keeping property naming style consistent accross
             * languajes. By default, property naming in js should use camelcase and property naming
             * in JSON api should use snake case with underscores.
             *
             * If `false` is given, then renaming is disabled
             *
             * @param {function|false} _value encoding function
             * @return {ModelBuilder} self
             */
            setNameEncoder: function(_encoder) {
              nameEncoder = _encoder;
              return this;
            },

            /**
             * @memberof ModelBuilder#
             *
             * @description Disables renaming alltogether
             *
             * @return {ModelBuilder} self
             */
            disableRenaming: function() {
              return this
                .setNameDecoder(false)
                .setNameEncoder(false);
            },

            /**
             * @memberof ModelBuilder#
             *
             * @description Extends the builder DSL
             *
             * Adds a function to de builder and alternatively maps the function to an
             * attribute definition keyword that can be later used when calling
             * `define` or `attribute`.
             *
             * Mapping works as following:
             *
             *    // Given the following call
             *    builder.extend('testAttr', function(_attr, _test, _param1, param2) {
             *      // wharever..
             *    }, ['test', 'testP1', 'testP2']);
             *
             *    // A call to
             *    builder.attribute('chapter', { test: 'hello', testP1: 'world' });
             *
             *    // Its equivalent to
             *    builder.testAttr('chapter', 'hello', 'world');
             *
             * The method can also be passed an object with various methods to be added.
             *
             * @param {string|object} _name function name or object to merge
             * @param {function} _fun function
             * @param {array} _mapping function mapping definition
             * @return {ModelBuilder} self
             */
            extend: function(_name, _fun, _mapping) {
              if(typeof _name === 'string') {
                this[_name] = Utils.override(this[name], _fun);
                if(_mapping) {
                  mappings[_mapping[0]] = _mapping;
                  _mapping[0] = _name;
                }
              } else Utils.extendOverriden(this, _name);
              return this;
            },
            /**
             * @memberof ModelBuilder#
             *
             * @description Parses a description object, calls the proper builder method depending
             * on each property description type.
             *
             * @param {object} _description The description object
             * @return {ModelBuilder} self
             */
            describe: function(_description) {
              forEach(_description, function(_desc, _attr) {
                if(isObject(_desc)) this.attribute(_attr, _desc);
                else if(isFunction(_desc)) this.define(_attr, _desc);
                else this.attrDefault(_attr, _desc);
              }, this);
              return this;
            },

            /**
             * @memberof ModelBuilder#
             *
             * @description Sets an attribute properties.
             *
             * This method uses the attribute modifiers mapping to call proper
             * modifiers on the argument.
             *
             * For example, using the following description on the createdAt attribute
             *
             *    { decode: 'date', param; 'YY-mm-dd' }
             *
             * Is the same as calling
             *
             *    builder.attrDecoder('createdAt', 'date', 'YY-mm-dd')
             *
             * @param {string} _name Attribute name
             * @param {object} _description Description object
             * @return {ModelBuilder} self
             */
            attribute: function(_name, _description) {
              var key, map, args, i;
              for(key in _description) {
                if(_description.hasOwnProperty(key)) {
                  map = mappings[key];
                  if(map) {
                    args = [_name, _description[key]];
                    for(i = 1; i < map.length; i++) {
                      args.push(_description[map[i]]);
                    }
                    args.push(_description);
                    this[map[0]].apply(this, args);
                  }
                }
              }
              return this;
            },

            /**
             * @memberof ModelBuilder#
             *
             * @description Sets the default value for an attribute.
             *
             * Defaults values are set only on object construction phase.
             *
             * if `_init` is a function, then its evaluated every time the
             * default value is required.
             *
             * @param {string} _attr Attribute name
             * @param {mixed} _init Defaulf value / iniline function
             * @return {ModelBuilder} self
             */
            attrDefault: function(_attr, _init) {
              // IDEA: maybe fixed defaults could be added to Model prototype...
              defaults.push([_attr, _init]);
              return this;
            },

            /**
             * @memberof ModelBuilder#
             *
             * @description Sets an attribute mask.
             *
             * @param {string} _attr Attribute name
             * @param {boolean|integer} _mask Ignore mask or true to use SyncMask.ALL
             * @param {boolean} _reset If set to true, old mask is reset.
             * @return {ModelBuilder} self
             */
            attrMask: function(_attr, _mask, _reset) {

              if(_mask === true) {
                masks[_attr] = SyncMask.ALL;
              } else if(_mask === false) {
                delete masks[_attr];
              } else if(_reset) {
                masks[_attr] = _mask;
              } else {
                masks[_attr] |= _mask;
              }

              return this;
            },

            /**
             * @memberof ModelBuilder#
             *
             * @description Assigns a serializer to a given attribute.
             *
             * A _serializer is:
             * * an object that defines both a `decode` and a `encode` method
             * * a function that when called returns an object that matches the above description.
             * * a string that represents an injectable that matches any of the above descriptions.
             *
             * @param {string} _name Attribute name
             * @param {string|object|function} _serializer The serializer
             * @return {ModelBuilder} self
             */
            attrSerializer: function(_name, _serializer, _opt) {
              if(typeof _serializer === 'string') {
                _serializer = $injector.get($inflector.camelize(_serializer, true) + 'Serializer');
              }

              // TODO: if(!_serializer) throw $setupError
              if(isFunction(_serializer)) _serializer = _serializer(_opt);
              if(_serializer.decode) this.attrDecoder(_name, bind(_serializer, _serializer.decode));
              if(_serializer.encode) this.attrEncoder(_name, bind(_serializer, _serializer.encode));
              return this;
            },

            /**
             * @memberof ModelBuilder#
             *
             * @description Assigns a decoding function/filter to a given attribute.
             *
             * @param {string} _name Attribute name
             * @param {string|function} _filter filter or function to register
             * @param {mixed} _filterParam Misc filter parameter
             * @param {boolean} _chain If true, filter is chained to the current attribute filter.
             * @return {ModelBuilder} self
             */
            attrDecoder: function(_name, _filter, _filterParam, _chain) {
              if(typeof _filter === 'string') {
                var filter = $filter(_filter);
                // TODO: if(!_filter) throw $setupError
                _filter = function(_value) { return filter(_value, _filterParam); };
              }

              decoders[_name] = _chain ? Utils.chain(decoders[_name], _filter) : _filter;
              return this;
            },

            /**
             * @memberof ModelBuilder#
             *
             * @description Assigns a encoding function/filter to a given attribute.
             *
             * @param {string} _name Attribute name
             * @param {string|function} _filter filter or function to register
             * @param {mixed} _filterParam Misc filter parameter
             * @param {boolean} _chain If true, filter is chained to the current attribute filter.
             * @return {ModelBuilder} self
             */
            attrEncoder: function(_name, _filter, _filterParam, _chain) {
              if(typeof _filter === 'string') {
                var filter = $filter(_filter);
                // TODO: if(!_filter) throw $setupError
                _filter = function(_value) { return filter(_value, _filterParam); };
              }

              encoders[_name] = _chain ? Utils.chain(encoders[_name], _filter) : _filter;
              return this;
            },

            /**
             * @memberof ModelBuilder#
             *
             * @description Registers a model hasMany relation
             *
             * The `_model` attribute supports both a string (using injector) o
             * a direct restmod Model type reference.
             *
             * @param {string}  _name Attribute name
             * @param {string|object} _model Other model
             * @param {string} _url Partial url
             * @return {ModelBuilder} self
             */
            hasMany: function(_name, _model, _alias) {
              return this.attrDefault(_name, function() {
                if(typeof _model === 'string') _model = $injector.get(_model); // inject type (only the first time...)
                return _model.$collection(null, _alias || $inflector.parameterize(_name), this); // TODO: put snakecase transformation in URLBuilder
              }).attrDecoder(_name, function(_raw) {
                this[_name].$feed(_raw);
              }).attrMask(_name, SyncMask.ENCODE);
            },

            /**
             * @memberof ModelBuilder#
             *
             * @description Registers a model hasOne relation
             *
             * The `_model` attribute supports both a string (using injector) o
             * a direct restmod Model type reference.
             *
             * @param {string}  _name Attribute name
             * @param {string|object} _model Other model
             * @param {string} _url Partial url
             * @return {ModelBuilder} self
             */
            hasOne: function(_name, _model, _partial) {
              return this.attrDefault(_name, function() {
                if(typeof _model === 'string') _model = $injector.get(_model); // inject type (only the first time...)
                return new _model(null, _partial || $inflector.parameterize(_name), this); // TODO: put snakecase transformation in URLBuilder
              }).attrDecoder(_name, function(_raw) {
                this[_name].$decode(_raw);
              }).attrMask(_name, SyncMask.ENCODE);
            },

            /**
             * @memberof ModelBuilder#
             *
             * @description Registers an instance method
             *
             * Usage:
             *    builder.define(function(_super) {
             *      return $fetch()
             *    });
             *
             * It is posible to override an existing method using define,
             * if overriden, the old method can be called using `this.$super`
             * inside de new method.
             *
             * @param {string} _name Method name
             * @param {function} _fun Function to define
             * @return {ModelBuilder} self
             */
            define: function(_name, _fun) {
              if(typeof _name === 'string') {
                Model.prototype[_name] = Utils.override(Model.prototype[_name], _fun);
              } else {
                Utils.extendOverriden(Model.prototype, _name);
              }
              return this;
            },

            /**
             * @memberof ModelBuilder#
             *
             * @description Registers a class method
             *
             * It is posible to override an existing method using define,
             * if overriden, the old method can be called using `this.$super`
             * inside de new method.
             *
             * @param {string} _name Method name
             * @param {function} _fun Function to define
             * @return {ModelBuilder} self
             */
            classDefine: function(_name, _fun) {
              if(typeof _name === 'string') {
                Collection[_name] = Utils.override(Collection[_name], _fun);
              } else {
                Utils.extendOverriden(Collection, _name);
              }
              return this;
            },

            /**
             * @memberof ModelBuilder#
             *
             * @description Adds an event hook
             *
             * Hooks are used to extend or modify the model behavior, and are not
             * designed to be used as an event listening system.
             *
             * The given function is executed in the hook's context, different hooks
             * make different parameters available to callbacks.
             *
             * @param {string} _hook The hook name, refer to restmod docs for builtin hooks.
             * @param {function} _do function to be executed
             * @return {ModelBuilder} self
             */
            on: function(_hook, _do) {
              var cbs = callbacks[_hook];
              if(!cbs) cbs = callbacks[_hook] = [];
              cbs.push(_do);
              return this;
            },

            beforeRequest: function(_do) { return this.on('before-request', _do); },
            afterRequest: function(_do) { return this.on('after-request', _do); },
            afterRequestError: function(_do) { return this.on('after-request-error', _do); },
            beforeSave: function(_do) { return this.on('before-save', _do); },
            beforeCreate: function(_do) { return this.on('before-create', _do); },
            afterCreate: function(_do) { return this.on('after-create', _do); },
            beforeUpdate: function(_do) { return this.on('before-update', _do); },
            afterUpdate: function(_do) { return this.on('after-update', _do); },
            afterSave: function(_do) { return this.on('after-save', _do); },
            beforeDestroy: function(_do) { return this.on('before-destroy', _do); },
            afterDestroy: function(_do) { return this.on('after-destroy', _do); },
            afterFeed: function(_do) { return this.on('after-feed', _do); },
            beforeRender: function(_do) { return this.on('before-render', _do); },

            /// Experimental modifiers

            /**
             * @memberof ModelBuilder#
             *
             * @description Expression attributes are evaluated every time new data is fed to the model.
             *
             * @param {string}  _name Attribute name
             * @param {string} _expr Angular expression to evaluate
             * @return {ModelBuilder} self
             */
            attrExpression: function(_name, _expr) {
              var filter = $parse(_expr);
              this.on('after-feed', function() {
                this[_name] = filter(this);
              });
            }
          };

          // use the builder to process a mixin chain
          function loadMixinChain(_chain) {
            for(var i = 0, l = _chain.length; i < l; i++) {
              loadMixin(_chain[i]);
            }
          }

          // use the builder to process a single mixin
          function loadMixin(_mix) {
            if(_mix.$chain) {
              loadMixinChain(_mix.$chain);
            } else if(typeof _mix === 'string') {
              loadMixin($injector.get(_mix));
            } else if(isArray(_mix) || isFunction(_mix)) {
              // TODO: maybe invoke should only be called for BASE_CHAIN functions
              $injector.invoke(_mix, Builder, { $builder: Builder });
            } else Builder.describe(_mix);
          }

          loadMixinChain(BASE_CHAIN);
          loadMixinChain(Model.$chain = arraySlice.call(arguments, 1));

          /*
           * Mixin post-processing phase
           */

          // by default use the restUrlBuilder
          urlBuilder = (urlBuilderFactory || $injector.get('restUrlBuilderFactory')())(_urlParams);

          // TODO postprocessing of collection prototype.
          extend(Model, Collection);

          return Model;
        },

        /**
         * @method mixin
         * @memberOf services.$restmod#
         *
         * @description
         *
         * The mixin factory
         *
         * A mixin is just a metadata container that can be included in a mixin chain.
         *
         * @return {object} The abstract model
         */
        mixin: function(/* mixins */) {
          return { $isAbstract: true, $chain: arraySlice.call(arguments, 0) };
        }
      };
    }]
  };
})
.factory('model', ['$restmod', function($restmod) {
  return $restmod.model;
}])
.factory('mixin', ['$restmod', function($restmod) {
  return $restmod.mixin;
}])
// make SyncMask available as constant
.constant('SyncMask', SyncMask);


/**
 * @method restUrlBuilderFactory
 * @memberOf constants
 *
 * @description This will no longer be provided as a constant.
 */
angular.module('plRestmod')
  .constant('restUrlBuilderFactory', (function() {

    // Url join function
    function joinUrl(_base/*, parts */) {
      var i = 1, url = (_base + '').replace(/\/$/, ''), partial;
      while((partial = arguments[i++]) !== undefined) {
        url += '/' + (partial + '').replace(/(\/$|^\/)/g, '');
      }
      return url;
    }

    return function(_options) {

      _options = _options || {};
      var primary = _options.primary || 'id';

      /**
       * @class RestUrlBuilder
       *
       * @description The default url builder implementation
       *
       * Instances of RestUrlBuilder are generated using the restUrlBuilderFactory.
       * The restUrlBuilderFactory is provided as constant and is actually a factory factory.
       *
       * Factory usage:
       *
       * ```javascript
       * return $restmod(function() {
       *   var builderFactory = restUrlBuilderFactory({ options }); // restUrlBuilderFactory injection not shown.
       *   this.setUrlBuilderFactory(builderFactory);
       *   // or using the provided helper.
       *   this.setRestUrlOptions({ options });
       * });
       * ```
       *
       */
      return function(_resUrl) {

        if(_options.baseUrl) _resUrl = joinUrl(_options.baseUrl, _resUrl);

        // gives the finishing touches to an url before returning
        function prepareUrl(_url, _opt) {
          if(_url) {
            _url = _url.replace(/\/$/, ''); // always remove trailing slash
            var ext = (_opt && _opt.extension !== undefined) ? _opt.extension : _options.extension;
            if(ext) {
              _url += ext[0] !== '.' ? '.' + ext : ext;
            }
          }
          return _url;
        }

        return {
          /**
           * @method
           * @memberOf RestUrlBuilder#
           *
           * @description Called to provide a resource's primary key given a resource.
           *
           * IDEA: replace this by something like extractKey?
           */
          inferKey: function(/* _res */) {
            return primary;
          },
          /**
           * @method
           * @memberOf RestUrlBuilder#
           *
           * @description Called to provide a resource's url.
           *
           * The resource url is used to fetch resource contents and to provide
           * a base url for children.
           *
           * IDEA: merge resourceUrl and collectionUrl code?
           *
           * @param  {Model} _res target resource
           * @param  {mixed} _opt options passed to the $url() function.
           * @return {string} The resource url, null if anonymous
           */
          resourceUrl: function(_res, _opt) {
            var partial = _res.$partial,
                pk = _res[primary];

            // TODO: prefer object 'url' property before anything
            // prefer baseUrl + pk => $context + partial => $context + pk => partial
            // TODO: not sure about these priorities, pk is before partial just to
            // have the same logic for fetch and update...

            if(pk != null && _resUrl) return prepareUrl(joinUrl(_resUrl, pk), _opt);
            if(_res.$context) {
              var ctxUrl = _res.$context.$url({ extension: false });
              if(partial != null && _res.$context) return prepareUrl(joinUrl(ctxUrl, partial), _opt);
              if(pk != null && _res.$context) return prepareUrl(joinUrl(ctxUrl, pk), _opt);
            }
            if(partial != null) return prepareUrl(partial);
            return null;
          },
          /**
           * @method
           * @memberOf RestUrlBuilder#
           *
           * @description Called to provide a collection's url.
           *
           * The collection url is used to fetch collection contents and to provide
           * a base url for children.
           *
           * @param  {Collection} _col target collection
           * @param  {mixed} _opt options passed to the $url() function.
           * @return {string} The collection url, null if anonymous
           */
          collectionUrl: function(_col, _opt) {
            if(_col.$context) {
              var base = _col.$context.$url({ extension: false });
              if(!base) return null;
              return prepareUrl(_col.$partial ? joinUrl(base, _col.$partial) : base, _opt);
            } else if(_col.$partial) {
              return prepareUrl(_col.$partial, _opt);
            } else {
              return prepareUrl(_resUrl, _opt);
            }
          },
          /**
           * @method
           * @memberOf RestUrlBuilder#
           *
           * @description Called to provide an url for resource creation.
           *
           * @param {Model} _res target resource
           * @return {string} url
           */
          createUrl: function(_res) {
            return _res.$context ? _res.$context.$url() : prepareUrl(_resUrl);
          },
          /**
           * @method
           * @memberOf RestUrlBuilder#
           *
           * @description Called to provide an url for resource update.
           *
           * Returns the resource url by default.
           *
           * @param {Model} _res target resource
           * @return {string} url
           */
          updateUrl: function(_res) {
            return this.resourceUrl(_res);
          },
          /**
           * @method
           * @memberOf RestUrlBuilder#
           *
           * @description Called to provide an url for resource destruction.
           *
           * Returns the resource url by default.
           *
           * @param {Model} _res target resource
           * @return {string} url
           */
          destroyUrl: function(_res) {
            return this.resourceUrl(_res);
          }
        };
      };
    };
  })())
  .config(['$restmodProvider', function($restmodProvider) {
    $restmodProvider.pushModelBase(['$injector', function($injector) {
      /**
       * @method setRestUrlOption
       * @memberof ModelBuilder#
       *
       * @description The setRestUrlOptions extensions allows to easily setup a rest url builder factory
       * for a given model chain.
       *
       * This is only available if the restUrlBuilderFactory is included.
       *
       * TODO: improve inheritance support.
       *
       * Available `options` are:
       * * primary: the selected primary key, defaults to 'id'.
       * * baseUrl: the api base url, this will be prepended to every url path.
       * * extension: a extension to append to every generated url.
       *
       * @param  {object} _options Options
       * @return {ModelBuilder} self
       */
      this.extend('setRestUrlOptions', function(_options) {
        return this.setUrlBuilderFactory($injector.get('restUrlBuilderFactory')(_options));
      });
    }]);
  }]);
})(angular);