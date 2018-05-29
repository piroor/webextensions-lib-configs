/*
 license: The MIT License, Copyright (c) 2016-2018 YUKI "Piro" Hiroshi
 original:
   http://github.com/piroor/webextensions-lib-configs
*/

'use strict';

function Configs(aDefaults, aOptions = { syncKeys: [] }) {
  this.$default = aDefaults;
  this.$logging = aOptions.logging || false;
  this.$locked = {};
  this.$lastValues = {};
  this.$syncKeys = aOptions.localKeys ? 
    Object.keys(aDefaults).filter(x => !aOptions.localKeys.includes(x)) : 
    (aOptions.syncKeys || []);
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

  $addObserver(aObserver) {
    var index = this.$observers.indexOf(aObserver);
    if (index < 0)
      this.$observers.push(aObserver);
  },
  $removeObserver(aObserver) {
    var index = this.$observers.indexOf(aObserver);
    if (index > -1)
      this.$observers.splice(index, 1);
  },
  $observers : [],

  get $shouldUseStorage() {
    return typeof browser.storage !== 'undefined' &&
             location.protocol === 'moz-extension:';
  },

  $log(aMessage, ...aArgs) {
    if (!this.$logging)
      return;

    var type = this.$shouldUseStorage ? 'storage' : 'bridge' ;
    aMessage = `Configs[${type}] ${aMessage}`;
    if (typeof window.log === 'function')
      log(aMessage, ...aArgs);
    else
      console.log(aMessage, ...aArgs);
  },

  $load() {
    return this.$_promisedLoad ||
             (this.$_promisedLoad = this.$tryLoad());
  },

  $tryLoad : async function() {
    this.$log('load');
    this.$applyValues(this.$default);
    browser.runtime.onMessage.addListener(this.$onMessage.bind(this));
    let values;
    try {
      if (this.$shouldUseStorage) { // background mode
        this.$log(`load: try load from storage on  ${location.href}`);
        let [localValues, managedValues, lockedKeys] = await Promise.all([
          browser.storage.local.get(this.$default),
          (async () => {
            if (!browser.storage.managed)
              return null;
            try {
              const managedValues = await browser.storage.managed.get();
              return managedValues || null;
            }
            catch(e) {
              return null;
            }
          })(),
          (async () => {
            try {
              const lockedKeys = await browser.runtime.sendMessage({ type : 'Configs:request:locked' })
              return lockedKeys;
            }
            catch(e) {
            }
            return {};
          })()
        ]);
        this.$log(`load: loaded for ${location.origin}:`, { localValues, managedValues, lockedKeys });
        values = Object.assign({}, localValues || {}, managedValues || {});
        this.$applyValues(values);
        lockedKeys = Object.keys(lockedKeys || {});
        if (managedValues)
          lockedKeys = lockedKeys.concat(Object.keys(managedValues));
        for (let key of lockedKeys) {
          this.$updateLocked(key, true);
        }
        browser.storage.onChanged.addListener(this.$onChanged.bind(this));
        if (this.$syncKeys || this.$syncKeys.length > 0) {
          try {
            browser.storage.sync.get(this.$syncKeys).then(syncedValues => {
              if (!syncedValues)
                return;
              for (let key of Object.keys(syncedValues)) {
                this[key] = syncedValues[key];
              }
            });
          }
          catch(e) {
            return null;
          }
        }
      }
      else { // content mode
        this.$log('load: initialize promise on  ' + location.href);
        let response;
        while (true) {
          response = await browser.runtime.sendMessage({
              type : 'Configs:request:load'
            });
          if (response)
            break;
          this.$log('load: waiting for anyone can access to the storage... ' + location.href);
          await new Promise((aResolve, aReject) => setTimeout(aResolve, 200));
        }
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
  $applyValues(aValues) {
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
          if (aValue == this.$lastValues[aKey])
            return aValue;
          this.$log(`set: ${aKey} = ${aValue}`);
          this.$lastValues[aKey] = aValue;
          this.$notifyUpdated(aKey);
          return aValue;
        }
      });
    });
  },

  $lock(aKey) {
    this.$log('locking: ' + aKey);
    this.$updateLocked(aKey, true);
    this.$notifyUpdated(aKey);
  },

  $unlock(aKey) {
    this.$log('unlocking: ' + aKey);
    this.$updateLocked(aKey, false);
    this.$notifyUpdated(aKey);
  },

  $updateLocked(aKey, aLocked) {
    if (aLocked) {
      this.$locked[aKey] = true;
    }
    else {
      delete this.$locked[aKey];
    }
  },

  $onMessage(aMessage, aSender, aRespond) {
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
    'Configs:request:locked',
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

      case 'Configs:request:locked': {
        let values = await this.$load();
        return this.$locked;
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

  $onChanged(aChanges) {
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
          try {
            browser.storage.sync.set(updatedKey, () => {
              this.$log('successfully synced', updatedKey);
            });
          }
          catch(e) {
          }
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
  $notifyToObservers(aKey) {
    this.$observers.forEach(aObserver => {
      if (typeof aObserver === 'function')
        aObserver(aKey);
      else if (aObserver && typeof aObserver.onChangeConfig === 'function')
        aObserver.onChangeConfig(aKey);
    });
  }
};
