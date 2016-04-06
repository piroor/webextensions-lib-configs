/*
 license: The MIT License, Copyright (c) 2016 YUKI "Piro" Hiroshi
 original:
   http://github.com/piroor/webextensions-lib-configs
*/

function Configs(aDefaults) {
	this.$default = aDefaults;
	this._lastValues = {};
	this.$loaded = this._load();
}
Configs.prototype = {
	$reset : function()
	{
		this._applyValues(this.$default);
		if (this._shouldUseStorage) {
			this._broadcast({
				type : 'Configs:reseted'
			});
		}
		else {
			chrome.runtime.sendMessage({
				type : 'Configs:reset'
			});
		}
	},

	get _shouldUseStorage()
	{
		return typeof chrome.storage !== 'undefined';
	},

	_log : function(aMessage, ...aArgs)
	{
		var type = this._shouldUseStorage ? 'storage' : 'bridge' ;
		aMessage = 'Configs[' + type + '] ' + aMessage;
		if (typeof log === 'function')
			log(aMessage, ...aArgs);
		else
			console.log(aMessage, ...aArgs);
	},

	_load : function()
	{
		this._log('load');
		if (this._promisedLoad)
			return this._promisedLoad;

		this._applyValues(this.$default);
		chrome.runtime.onMessage.addListener(this._onMessage.bind(this));

		if (this._shouldUseStorage) { // background mode
			this._log('load: try load from storage');
			return this._promisedLoad = new Promise((function(aResolve, aReject) {
				try {
					chrome.storage.local.get(this.$default, (function(aValues) {
						this._log('load: loaded', aValues);
						this._applyValues(aValues);
						this._notifyLoaded();
						aResolve();
					}).bind(this));
				}
				catch(e) {
					this._log('load: failed', e);
					aReject(e);
				}
			}).bind(this));
		}
		else { // content mode
			this._log('load: initialize promise');
			this._promisedLoad = new Promise((function(aResolve, aReject) {
				this._promisedLoadResolver = aResolve;
			}).bind(this))
				.then((function(aValues) {
					this._log('load: promise resolved');
					this._applyValues(aValues);
				}).bind(this));
			chrome.runtime.sendMessage({
				type : 'Configs:load'
			});
			return this._promisedLoad;
		}
	},
	_applyValues : function(aValues)
	{
		Object.keys(aValues).forEach(function(aKey) {
			this._lastValues[aKey] = aValues[aKey];
			if (aKey in this)
				return;
			Object.defineProperty(this, aKey, {
				get: (function() {
					return this._lastValues[aKey];
				}).bind(this),
				set: (function(aValue) {
					this._log('set: ' + aKey + ' = ' + aValue);
					this._lastValues[aKey] = aValue;
					this._notifyUpdated(aKey);
					return aValue;
				}).bind(this)
			});
		}, this);
	},

	_onMessage : function(aMessage)
	{
		this._log('onMessage: ' + aMessage.type);
		switch (aMessage.type)
		{
			// background
			case 'Configs:load':
				this._load().then(this._notifyLoaded.bind(this));
				break;
			case 'Configs:update':
				this[aMessage.key] = aMessage.value;
				break;
			case 'Configs:reset':
				this.$reset();
				break;

			// content
			case 'Configs:loaded':
				if (this._promisedLoadResolver)
					this._promisedLoadResolver(aMessage.values);
				delete this._promisedLoadResolver;
				break;
			case 'Configs:updated':
				this._lastValues[aMessage.key] = aMessage.value;
				break;
			case 'Configs:reseted':
				this._applyValues(this.$default);
				break;
		}
	},

	_broadcast : function(aMessage)
	{
		chrome.tabs.query({}, (function(aTabs) {
			aTabs.forEach(function(aTab) {
				chrome.tabs.sendMessage(aTab.id, aMessage);
			}, this);
		}).bind(this));
	},
	_notifyLoaded : function()
	{
		this._broadcast({
			type   : 'Configs:loaded',
			values : this._lastValues
		});
	},
	_notifyUpdated : function(aKey)
	{
		var value = this[aKey];
		if (this._shouldUseStorage) {
			this._log('broadcast updated config: ' + aKey + ' = ' + value);
			this._broadcast({
				type  : 'Configs:updated',
				key   : aKey,
				value : value
			});
		}
		else {
			this._log('request to store config: ' + aKey + ' = ' + value);
			chrome.runtime.sendMessage({
				type  : 'Configs:update',
				key   : aKey,
				value : value
			});
		}
	},
	_notifyLoaded : function()
	{
		this._broadcast({
			type   : 'Configs:loaded',
			values : this._lastValues
		});
	}
};
