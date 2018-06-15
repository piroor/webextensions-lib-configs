/*
 license: The MIT License, Copyright (c) 2016-2018 YUKI "Piro" Hiroshi
 original:
   http://github.com/piroor/webextensions-lib-configs
*/

'use strict';

function Configs(aDefaults, aOptions = { syncKeys: [] }) {
  this.$default = aDefaults;
  this.$logging = aOptions.logging || false;
  this.$locked = new Set();
  this.$lastValues = {};
  this.$syncKeys = aOptions.localKeys ? 
    Object.keys(aDefaults).filter(x => !aOptions.localKeys.includes(x)) : 
    (aOptions.syncKeys || []);
  this.$loaded = this.$load();
}
Configs.prototype = {
  $reset : async function() {
    this.$applyValues(this.$default);
  },

  $addObserver(aObserver) {
    if (!this.$observers.has(aObserver))
      this.$observers.set(aObserver);
  },
  $removeObserver(aObserver) {
    this.$observers.delete(aObserver);
  },
  $observers : new Set(),

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
      if (managedValues)
        lockedKeys = lockedKeys.concat(Array.from(managedValues.keys()));
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
      if (this.$locked.has(aKey))
        return;
      this.$lastValues[aKey] = aValues[aKey];
      if (aKey in this)
        return;
      Object.defineProperty(this, aKey, {
        get: () => this.$lastValues[aKey],
        set: (aValue) => {
          if (this.$locked.has(aKey)) {
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
      this.$locked.set(aKey, true);
    }
    else {
      this.$locked.delete(aKey);
    }
  },

  $onMessage(aMessage, aSender) {
    if (!aMessage ||
        typeof aMessage.type != 'string')
      return;

    this.$log(`onMessage: ${aMessage.type}`, aMessage, aSender);
    switch (aMessage.type) {
      case 'Configs:request:locked':
        return (async () => {
          await this.$load();
          return this.$locked.values();
        })();
        break;

      case 'Configs:update':
        this.$updateLocked(aMessage.key, aMessage.locked);
        this[aMessage.key] = aMessage.value;
        break;
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
    const locked = this.$locked.has(aKey);
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
