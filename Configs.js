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
              type: 'Configs:getLockedKeys'
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
    for (const [key, value] of aValues) {
      if (this.$locked.has(key))
        continue;
      this.$lastValues[key] = value;
      if (key in this)
        return;
      Object.defineProperty(this, key, {
        get: () => this.$lastValues[key],
        set: (aValue) => this.$setValue(key, aValue)
      });
    }
  },

  $setValue(aKey, aValue) {
    if (this.$locked.has(aKey)) {
      this.$log(`warning: ${aKey} is locked and not updated`);
      return aValue;
    }
    if (JSON.stringify(aValue) == JSON.stringify(this.$lastValues[aKey]))
      return aValue;
    this.$log(`set: ${aKey} = ${aValue}`);
    this.$lastValues[aKey] = aValue;

    const update = {};
    update[aKey] = aValue;
    try {
      browser.storage.local.set(update, () => {
        this.$log('successfully saved', update);
      });
    }
    catch(e) {
      this.$log('save: failed', e);
    }
    try {
      if (this.$syncKeys.includes(aKey))
        browser.storage.sync.set(update, () => {
          this.$log('successfully synced', update);
        });
    }
    catch(e) {
      this.$log('sync: failed', e);
    }
    return aValue;
  },

  $lock(aKey) {
    this.$log('locking: ' + aKey);
    this.$updateLocked(aKey, true);
  },

  $unlock(aKey) {
    this.$log('unlocking: ' + aKey);
    this.$updateLocked(aKey, false);
  },

  $updateLocked(aKey, aLocked) {
    if (aLocked) {
      this.$locked.set(aKey, true);
    }
    else {
      this.$locked.delete(aKey);
    }
    if (browser.runtime)
      browser.runtime.sendMessage({
        type:   'Configs:updateLocked',
        key:    aKey,
        locked: this.$locked.has(aKey)
      });
  },

  $onMessage(aMessage, aSender) {
    if (!aMessage ||
        typeof aMessage.type != 'string')
      return;

    this.$log(`onMessage: ${aMessage.type}`, aMessage, aSender);
    switch (aMessage.type) {
      case 'Configs:getLockedKeys':
        return Promise.resolve(this.$locked.values());

      case 'Configs:updateLocked':
        this.$updateLocked(aMessage.key, aMessage.locked);
        break;
    }
  },

  $onChanged(aChanges) {
    for (const [key, change] of Object.entries(aChanges)) {
      this.$lastValues[key] = change.newValue;
      this.$notifyToObservers(key);
    }
  },

  $notifyToObservers(aKey) {
    for (const observer of this.$observers) {
      if (typeof observer === 'function')
        observer(aKey);
      else if (observer && typeof observer.onChangeConfig === 'function')
        observer.onChangeConfig(aKey);
    }
  }
};
