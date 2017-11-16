/*
 license: The MIT License, Copyright (c) 2016-2017 YUKI "Piro" Hiroshi
 original:
   http://github.com/piroor/webextensions-lib-configs
*/

'use strict';

function Configs(aDefaults, args = {syncKeys: []}) {
  this.$default = aDefaults;
  this.$logging = false;
  this.$locked = {};
  this.$lastValues = {};
  this.$syncKeys = args.syncKeys || [];
  this.$loaded = this.$load();
}
Configs.prototype = {
  $reset : async function() {
    this.$applyValues(this.$default);
    if (this.$shouldUseStorage) {
      return this.$broadcast({
        type : 'Configs:reseted'
      });
    }
    else {
      return await browser.runtime.sendMessage({
        type : 'Configs:request:reset'
      });
    }
  },

  $addObserver : function(aObserver) {
    var index = this.$observers.indexOf(aObserver);
    if (index < 0)
      this.$observers.push(aObserver);
  },
  $removeObserver : function(aObserver) {
    var index = this.$observers.indexOf(aObserver);
    if (index > -1)
      this.$observers.splice(index, 1);
  },
  $observers : [],

  get $shouldUseStorage() {
    return typeof browser.storage !== 'undefined' &&
             location.protocol === 'moz-extension:';
  },

  $log : function(aMessage, ...aArgs) {
    if (!this.$logging)
      return;

    var type = this.$shouldUseStorage ? 'storage' : 'bridge' ;
    aMessage = `Configs[${type}] ${aMessage}`;
    if (typeof window.log === 'function')
      log(aMessage, ...aArgs);
    else
      console.log(aMessage, ...aArgs);
  },

  $load : function() {
    return this.$_promisedLoad ||
             (this.$_promisedLoad = this.$tryLoad());
  },

  $tryLoad : async function() {
    this.$log('load');
    this.$applyValues(this.$default);
      browser.runtime.onMessage.addListener(this.$onMessage.bind(this));
    var values;
    try {
      if (this.$shouldUseStorage) { // background mode
        this.$log(`load: try load from storage on  ${location.href}`);
        values = await browser.storage.local.get(this.$default);
        values = values || this.$default;
        if (this.$syncKeys && this.$syncKeys.length) {
          let syncedValues = await browser.storage.sync.get(this.$syncKeys);
          this.$log(`load: loaded from sync for ${location.origin}`, syncedValues);
          values = Object.assign(values, syncedValues);
        }
        this.$log(`load: loaded for ${location.origin}`, values);
        this.$applyValues(values);
        if (browser.storage.managed) {
          try {
            let values = await browser.storage.managed.get();
            Object.keys(values).map(aKey => {
              this[aKey] = values[aKey];
              this.$updateLocked(aKey, true);
            });
          }
          catch(e) {
          }
        }
        browser.storage.onChanged.addListener(this.$onChanged.bind(this));
      }
      else { // content mode
        this.$log('load: initialize promise on  ' + location.href);
        let response = await browser.runtime.sendMessage({
              type : 'Configs:request:load'
            });
        this.$log('load: responded', response);
        values = response && response.values || this.$default;
        this.$applyValues(values);
        this.$locked = response && response.lockedKeys || {};
      }
      return values;
    }
    catch(e) {
      this.$log('load: failed', e, e.stack);
      throw e;
    }
  },
  $applyValues : function(aValues) {
    Object.keys(aValues).forEach(aKey => {
      if (aKey in this.$locked)
        return;
      this.$lastValues[aKey] = aValues[aKey];
      if (aKey in this)
        return;
      Object.defineProperty(this, aKey, {
        get: () => this.$lastValues[aKey],
        set: (aValue) => {
          if (aKey in this.$locked) {
            this.$log(`warning: ${aKey} is locked and not updated`);
            return aValue;
          }
          this.$log(`set: ${aKey} = ${aValue}`);
          this.$lastValues[aKey] = aValue;
          this.$notifyUpdated(aKey);
          return aValue;
        }
      });
    });
  },

  $lock : function(aKey) {
    this.$log('locking: ' + aKey);
    this.$updateLocked(aKey, true);
    this.$notifyUpdated(aKey);
  },

  $unlock : function(aKey) {
    this.$log('unlocking: ' + aKey);
    this.$updateLocked(aKey, false);
    this.$notifyUpdated(aKey);
  },

  $updateLocked : function(aKey, aLocked) {
    if (aLocked) {
      this.$locked[aKey] = true;
    }
    else {
      delete this.$locked[aKey];
    }
  },

  $onMessage : function(aMessage, aSender, aRespond) {
    if (!aMessage ||
        typeof aMessage.type != 'string')
      return;

    if ((this.$shouldUseStorage &&
         (this.BACKEND_COMMANDS.indexOf(aMessage.type) < 0)) ||
        (!this.$shouldUseStorage &&
         (this.FRONTEND_COMMANDS.indexOf(aMessage.type) < 0)))
      return;

    if (aMessage.type.indexOf('Configs:request:') == 0) {
      this.$processMessage(aMessage, aSender).then(aRespond);
      return true;
    }
    else {
      this.$processMessage(aMessage, aSender);
    }
  },

  BACKEND_COMMANDS: [
    'Configs:request:load',
    'Configs:update',
    'Configs:request:reset'
  ],
  FRONTEND_COMMANDS: [
    'Configs:updated',
    'Configs:reseted',
  ],
  $processMessage : async function(aMessage, aSender) {
    this.$log(`onMessage: ${aMessage.type}`, aMessage, aSender);
    switch (aMessage.type) {
      // backend (background, sidebar)
      case 'Configs:request:load': {
        let values = await this.$load();
        return {
          values     : values,
          lockedKeys : this.$locked
        };
      }; break;

      case 'Configs:update': {
        this.$updateLocked(aMessage.key, aMessage.locked);
        this[aMessage.key] = aMessage.value;
      }; break;

      case 'Configs:request:reset': {
        return this.$reset();
      }; break;


      // frontend (content, etc.)
      case 'Configs:updated': {
        this.$updateLocked(aMessage.key, aMessage.locked);
        this.$lastValues[aMessage.key] = aMessage.value;
        this.$notifyToObservers(aMessage.key);
      }; break;

      case 'Configs:reseted': {
        this.$applyValues(this.$default);
        Object.keys(this.$default).forEach(aKey => {
          this.$notifyToObservers(aKey);
        });
        break;
      }
    }
  },

  $onChanged : function(aChanges) {
    var changedKeys = Object.keys(aChanges);
    changedKeys.forEach(aKey => {
      this.$lastValues[aKey] = aChanges[aKey].newValue;
      this.$notifyToObservers(aKey);
    });
  },

  $broadcast : async function(aMessage) {
    var promises = [];
    if (browser.runtime) {
      promises.push(await browser.runtime.sendMessage(aMessage));
    }
    if (browser.tabs) {
      let tabs = await browser.tabs.query({ windowType: 'normal' });
      promises = promises.concat(tabs.map(aTab =>
                   browser.tabs.sendMessage(aTab.id, aMessage, null)));
    }
    return await Promise.all(promises);
  },
  $notifyUpdated : async function(aKey) {
    var value = this[aKey];
    var locked = aKey in this.$locked;
    if (this.$shouldUseStorage) {
      this.$log(`broadcast updated config: ${aKey} = ${value} (locked: ${locked})`);
      let updatedKey = {};
      updatedKey[aKey] = value;
      try {
        browser.storage.local.set(updatedKey, () => {
          this.$log('successfully saved', updatedKey);
        });
      }
      catch(e) {
        this.$log('save: failed', e);
      }
      try {
        if (this.$syncKeys.includes(aKey)) {
          browser.storage.sync.set(updatedKey, () => {
            this.$log('successfully synced', updatedKey);
          });
        }
      }
      catch(e) {
        this.$log('sync: failed', e);
      }
      return this.$broadcast({
        type  : 'Configs:updated',
        key   : aKey,
        value : value,
        locked : locked
      });
    }
    else {
      this.$log(`request to store config: ${aKey} = ${value} (locked: ${locked})`);
      return browser.runtime.sendMessage({
         type  : 'Configs:update',
         key   : aKey,
         value : value,
         locked : locked
      });
    }
  },
  $notifyToObservers : function(aKey) {
    this.$observers.forEach(aObserver => {
      if (typeof aObserver === 'function')
        aObserver(aKey);
      else if (aObserver && typeof aObserver.onChangeConfig === 'function')
        aObserver.onChangeConfig(aKey);
    });
  }
};
