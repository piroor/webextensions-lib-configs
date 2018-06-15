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
      return this.$broadcast({
        type : 'Configs:reseted'
      });
  },

  $addObserver(aObserver) {
    const index = this.$observers.indexOf(aObserver);
    if (index < 0)
      this.$observers.push(aObserver);
  },
  $removeObserver(aObserver) {
    const index = this.$observers.indexOf(aObserver);
    if (index > -1)
      this.$observers.splice(index, 1);
  },
  $observers : [],

  $log(aMessage, ...aArgs) {
    if (!this.$logging)
      return;

    aMessage = `Configs ${aMessage}`;
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
    let values;
    try {
        this.$log(`load: try load from storage on ${location.href}`);
        // We cannot define constants and variables at a time...
        // [const localValues, let managedValues, let lockedKeys] = await Promise.all([
        // eslint-disable-next-line prefer-const
        let [localValues, managedValues, lockedKeys] = await Promise.all([
          (async () => {
            try {
              const localValues = await browser.storage.local.get(this.$default);
              this.$log('load: successfully loaded local storage');
              return localValues;
            }
            catch(e) {
              this.$log('load: failed to load local storage: ', String(e));
            }
            return {};
          })(),
          (async () => {
            if (!browser.storage.managed) {
              this.$log('load: skip managed storage');
              return null;
            }
            try {
              const managedValues = await browser.storage.managed.get();
              this.$log('load: successfully loaded managed storage');
              return managedValues || null;
            }
            catch(e) {
              this.$log('load: failed to load managed storage: ', String(e));
            }
            return null;
          })(),
          (async () => {
            try {
              const lockedKeys = await browser.runtime.sendMessage({
                type : 'Configs:request:locked'
              });
              this.$log('load: successfully synchronized locked state');
              return lockedKeys;
            }
            catch(e) {
              this.$log('load: failed to synchronize locked state: ', String(e));
            }
            return {};
          })()
        ]);
        this.$log(`load: loaded for ${location.origin}:`, { localValues, managedValues, lockedKeys });
        values = Object.assign({}, localValues || {}, managedValues || {});
        this.$applyValues(values);
        this.$log('load: values are applied');
        lockedKeys = Object.keys(lockedKeys || {});
        if (managedValues)
          lockedKeys = lockedKeys.concat(Object.keys(managedValues));
        for (const key of lockedKeys) {
          this.$updateLocked(key, true);
        }
        this.$log('load: locked state is applied');
        browser.storage.onChanged.addListener(this.$onChanged.bind(this));
        if (this.$syncKeys || this.$syncKeys.length > 0) {
          try {
            browser.storage.sync.get(this.$syncKeys).then(syncedValues => {
              this.$log('load: successfully loaded sync storage');
              if (!syncedValues)
                return;
              for (const key of Object.keys(syncedValues)) {
                this[key] = syncedValues[key];
              }
            });
          }
          catch(e) {
            this.$log('load: failed to read sync storage: ', String(e));
            return null;
          }
        }
      browser.runtime.onMessage.addListener(this.$onMessage.bind(this));
      return values;
    }
    catch(e) {
      this.$log('load: fatal error: ', e, e.stack);
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
          if (JSON.stringify(aValue) == JSON.stringify(this.$lastValues[aKey]))
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
        const values = await this.$load();
        return {
          values     : values,
          lockedKeys : this.$locked
        };
      }; break;

      case 'Configs:request:locked': {
        await this.$load();
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
    const changedKeys = Object.keys(aChanges);
    changedKeys.forEach(aKey => {
      this.$lastValues[aKey] = aChanges[aKey].newValue;
      this.$notifyToObservers(aKey);
    });
  },

  $broadcast : async function(aMessage) {
    let promises = [];
    if (browser.runtime) {
      promises.push(await browser.runtime.sendMessage(aMessage));
    }
    if (browser.tabs) {
      const tabs = await browser.tabs.query({ windowType: 'normal' });
      promises = promises.concat(tabs.map(aTab =>
        browser.tabs.sendMessage(aTab.id, aMessage, null)));
    }
    return await Promise.all(promises);
  },
  $notifyUpdated : async function(aKey) {
    const value = this[aKey];
    const locked = aKey in this.$locked;
      this.$log(`broadcast updated config: ${aKey} = ${value} (locked: ${locked})`);
      const updatedKey = {};
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
          catch(_e) {
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
