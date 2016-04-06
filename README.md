# webextensions-lib-configs

Provides ability to store/load configurations.

## Required permissions

 * `storage`

## Usage

In `manifest.json`, load the file `Configs.js` from both the background page and others, like:

```json
{
  "background": {
    "scripts": [
      "path/to/Configs.js",
      "path/to/configs.js"
    ]
  },
  "content_scripts": [
    {
      "all_frames": true,
      "matches": [
        "<all_urls>"
      ],
      "js": [
        "path/to/Configs.js",
        "path/to/configs.js",
        "..."
      ],
      "run_at": "document_start"
    }
  ],
  "options_ui": {
    "page": "path/to/options.html",
    "chrome_style": true
  },
  "permissions": [
    "storage"
  ]
}
```

`options.html` is:

```html
<!DOCTYPE html>
<script type="application/javascript" src="./Configs.js"></script>
<script type="application/javascript" src="./configs.js"></script>
...
```

And, define an instance with default values for each namespace like:

```javascript
// configs.js

var configs = new Configs({
  enabled: true,
  advanced: false,
  attributes: 'alt|title'
});
```

The instance has only a property `$loaded` by default. Because it is a `Promise`, you can do something after all stored user values are loaded:

```javascript
configs.$loaded.then(function() {
  MyService.start();
});
```

After all values are loaded, you can access loaded values via its own properties same to the given default values:

```javascript
console.log(configs.enabled); // => true (default value)
console.log(configs.advanced); // => false (default value)
console.log(configs.attributes); // => "alt|title" (default value)
```

If you set a new value, it will be notified to the background page, then stored to the local storage as the user value and dispatched to all other namespaces.

```javascript
// in the options.html
configs.enabled = false;
```

```javascript
// in content script
console.log(configs.enabled); // => false (user value)
```

You still can get default values easily, with a prefix `$default.`:

```javascript
console.log(configs.$default.enabled); // => true (default value)
configs.enabled = configs.$default.enabled; // reset to default

configs.$reset(); // reset all to default values
```

