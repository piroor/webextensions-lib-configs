/*
 license: The MIT License, Copyright (c) 2016-2017 YUKI "Piro" Hiroshi
 original:
   http://github.com/piroor/webextensions-lib-configs
*/

function Configs(aDefaults) {
	this.$default = aDefaults;
	this.$locked = {};
	this.$lastValues = {};
	this.$loaded = this.$load();
}
Configs.prototype = {
	$reset : function()
	{
		this.$applyValues(this.$default);
		if (this.$shouldUseStorage) {
			return this.$broadcast({
				type : 'Configs:reseted'
			});
		}
		else {
			return new Promise((function(aResolve, aReject) {
				chrome.runtime.sendMessage(
					{
						type : 'Configs:reset'
					},
					function() {
						aResolve();
					}
				);
			}).bind(this));
		}
	},

	$addObserver : function(aObserver)
	{
		var index = this.$observers.indexOf(aObserver);
		if (index < 0)
			this.$observers.push(aObserver);
	},
	$removeObserver : function(aObserver)
	{
		var index = this.$observers.indexOf(aObserver);
		if (index > -1)
			this.$observers.splice(index, 1);
	},
	$observers : [],

	get $shouldUseStorage()
	{
		return typeof chrome.storage !== 'undefined' &&
				location.protocol === 'moz-extension:';
	},

	$log : function(aMessage, ...aArgs)
	{
		var type = this.$shouldUseStorage ? 'storage' : 'bridge' ;
		aMessage = 'Configs[' + type + '] ' + aMessage;
		if (typeof log === 'function')
			log(aMessage, ...aArgs);
		else
			console.log(aMessage, ...aArgs);
	},

	$load : function()
	{
		this.$log('load');
		if ('_promisedLoad' in this) {
			if (this._promisedLoad) {
				this.$log(' => waiting to be loaded');
				return this._promisedLoad;
			}
			this.$log(' => already loaded');
			return Promise.resolve(this.$lastValues);
		}

		this.$applyValues(this.$default);
		chrome.runtime.onMessage.addListener(this.$onMessage.bind(this));

		if (this.$shouldUseStorage) { // background mode
			this.$log('load: try load from storage on  ' + location.href);
			chrome.storage.onChanged.addListener(this.$onChanged.bind(this));
			return this._promisedLoad = new Promise((function(aResolve, aReject) {
				try {
					chrome.storage.local.get(this.$default, (function(aValues) {
						aValues = aValues || this.$default;
						this.$log('load: loaded for ' + location.origin, aValues);
						this.$applyValues(aValues);
						this._promisedLoad = null;
						aResolve(aValues);
						chrome.runtime.sendMessage( // copy locked state from others
							{ type : 'Configs:load' },
							(aResult) => {
								this.$log('load: responded from others', aResult);
								this.$locked = aResult.lockedKeys;
								Object.keys(this.$default).forEach((aKey) => {
									this.$notifyToObservers(aKey);
								});
							}
						);
					}).bind(this));
				}
				catch(e) {
					this.$log('load: failed', e);
					aReject(e);
				}
			}).bind(this));
		}
		else { // content mode
			this.$log('load: initialize promise on  ' + location.href);
			return this._promisedLoad = new Promise((function(aResolve, aReject) {
				chrome.runtime.sendMessage(
					{
						type : 'Configs:load'
					},
					(function(aResult) {
						this.$log('load: responded', aResult);
						var values = aResult.values || this.$default;
						this.$applyValues(values);
						this.$locked = aResult.lockedKeys;
						this._promisedLoad = null;
						aResolve(values);
					}).bind(this)
				);
			}).bind(this));
		}
	},
	$applyValues : function(aValues)
	{
		Object.keys(aValues).forEach(function(aKey) {
			if (aKey in this.$locked)
				return;
			this.$lastValues[aKey] = aValues[aKey];
			if (aKey in this)
				return;
			Object.defineProperty(this, aKey, {
				get: (function() {
					return this.$lastValues[aKey];
				}).bind(this),
				set: (function(aValue) {
					if (aKey in this.$locked) {
						this.$log('warning: ' + aKey + ' is locked and not updated');
						return aValue;
					}
					this.$log('set: ' + aKey + ' = ' + aValue);
					this.$lastValues[aKey] = aValue;
					this.$notifyUpdated(aKey);
					return aValue;
				}).bind(this)
			});
		}, this);
	},

	$lock : function(aKey)
	{
		this.$log('locking: ' + aKey);
		this.$updateLocked(aKey, true);
		this.$notifyUpdated(aKey);
	},

	$unlock : function(aKey)
	{
		this.$log('unlocking: ' + aKey);
		this.$updateLocked(aKey, false);
		this.$notifyUpdated(aKey);
	},

	$updateLocked : function(aKey, aLocked)
	{
		if (aLocked) {
			this.$locked[aKey] = true;
		} else {
			delete this.$locked[aKey];
		}
	},

	$onMessage : function(aMessage, aSender, aRespond)
	{
		this.$log('onMessage: ' + aMessage.type, aMessage, aSender);
		switch (aMessage.type)
		{
			// background
			case 'Configs:load':
				this.$load()
					.then((aValues) => {
						aRespond({
							values     : aValues,
							lockedKeys : this.$locked
						});
					});
				return true;
			case 'Configs:update':
				this.$updateLocked(aMessage.key, aMessage.locked);
				this[aMessage.key] = aMessage.value;
				aRespond();
				break;
			case 'Configs:reset':
				this.$reset().then(aRespond);
				return true;

			// content
			case 'Configs:updated':
				this.$updateLocked(aMessage.key, aMessage.locked);
				this.$lastValues[aMessage.key] = aMessage.value;
				this.$notifyToObservers(aMessage.key);
				aRespond();
				break;
			case 'Configs:reseted':
				this.$applyValues(this.$default);
				Object.keys(this.$default).forEach(function(aKey) {
					this.$notifyToObservers(aKey);
				}, this);
				aRespond();
				break;
		}
	},

	$onChanged : function(aChanges)
	{
		var changedKeys = Object.keys(aChanges);
		changedKeys.forEach(function(aKey) {
			this.$lastValues[aKey] = aChanges[aKey].newValue;
			this.$notifyToObservers(aKey);
		}, this);
	},

	$broadcast : function(aMessage)
	{
		var promises = [];

		if (chrome.runtime) {
			promises.push(new Promise((function(aResolve, aReject) {
				chrome.runtime.sendMessage(aMessage, function(aResult) {
					aResolve([aResult]);
				});
			}).bind(this)));
		}

		if (chrome.tabs) {
			promises.push(new Promise((function(aResolve, aReject) {
				chrome.tabs.query({}, (function(aTabs) {
					var promises = aTabs.map(function(aTab) {
						return new Promise((function(aResolve, aReject) {
							chrome.tabs.sendMessage(
								aTab.id,
								aMessage,
								null,
								aResolve
							);
						}).bind(this));
					}, this);
					Promise.all(promises).then(aResolve);
				}).bind(this));
			}).bind(this)));
		}

		return Promise.all(promises).then(function(aResultSets) {
			var flattenResults = [];
			aResultSets.forEach(function(aResults) {
				flattenResults = flattenResults.concat(aResults);
			});
			return flattenResults;
		});
	},
	$notifyUpdated : function(aKey)
	{
		var value = this[aKey];
		var locked = aKey in this.$locked;
		if (this.$shouldUseStorage) {
			this.$log('broadcast updated config: ' + aKey + ' = ' + value + ' (locked: ' + locked + ')');
			try {
				let updatedKey = {};
				updatedKey[aKey] = value;
				chrome.storage.local.set(updatedKey, (function() {
					this.$log('successfully saved', updatedKey);
				}).bind(this));
			}
			catch(e) {
				this.$log('save: failed', e);
			}
			return this.$broadcast({
				type  : 'Configs:updated',
				key   : aKey,
				value : value,
				locked : locked
			});
		}
		else {
			this.$log('request to store config: ' + aKey + ' = ' + value + ' (locked: ' + locked + ')');
			return new Promise((function(aResolve, aReject) {
				chrome.runtime.sendMessage(
					{
						type  : 'Configs:update',
						key   : aKey,
						value : value,
						locked : locked
					},
					function() {
						aResolve();
					}
				);
			}).bind(this));
		}
	},
	$notifyToObservers : function(aKey)
	{
		this.$observers.forEach(function(aObserver) {
			if (typeof aObserver === 'function')
				aObserver(aKey);
			else if (aObserver && typeof aObserver.onChangeConfig === 'function')
				aObserver.onChangeConfig(aKey);
		}, this);
	}
};
