# @bucky24/node-php
Allows running a PHP server via node.

This is basically the same thing as https://www.npmjs.com/package/node-php and https://www.npmjs.com/package/@windastella/php-server (which is basically what node-php is using under the hood), however those packages are dependent on `express` and will only work with express servers.

Why would you ever want to do this? You're a JavaScript programmer, not a PHP programmer! Well the fact remains that few webhosts offer node hosting. Most of them offer PHP hosting, meaning if you want to have server code, you're probably going to need to write it in PHP for most basic sites.

But then why node? Well because you're a JavaScript programmer, and you're probably writing your frontend in JavaScript. You might not want to install a full LAMP or WAMP stack. Apache does a number of powerful things but can be overkill for simple backends. (though given that you need PHP and probably have MySQL installed, we're basically building a LNMP or WNMP stack). This module gives you the ability to spin up an extremely lightweight web server that knows how to call PHP scripts to run those extremely simple backends.

In all honesty, like most of my modules, if you want to do the things I describe above, you should probably use one of the modules listed above, as they will be better and more feature-full than what I am building here. I built this for a number of reasons:

1) I like building things.
2) I want something that doesn't require express as a dependency.

You are probably using express, so it would be much easier in your case to just use `node-php` and be done with it.

If you are still here and have decided to move forward, then you probably will be interested in how to use this library:

# Usage

This module exports a single function. Under the hood, it's called `serve`, but since its a default export, you can call it whatever you like.

## serve

The serve method takes in the following parameters:

| Param | Type | Description |
|---|---|---|
| mainDirectory | File Path as String | The directory of the main php code. Required |
| port | Integer | The port to start the http server on. Required |

Example:

```
const serve = require("@bucky24/node-php");

serve(__dirname, 80);
```

# Server Limitations

This module is extremely feature-lean. To that effect, there are the following limitations:

* Not all request bodies are recognized. The system can recognize the following types:
    * application/json
    * application/x-www-form-urlencoded
* All responses from the server are sent with content-type text/html
* Any parameters in the query string will be overwritten in the $_REQUEST object by any duplicated keys in the request body. I'm not completely sure how PHP/Apache handles this normally.

The module only sets the following properties:

* $_REQUEST - all valid values
* $_GET - all valid values
* $_POST - all valid values
* $_SERVER['REQUEST_URI']

The module provides extremely limited .htaccess parsing:

* Only handles .htaccess in the starting directory
* Only handles mod_rewrite.c
* Only handles simple URL rewriting using RewriteRule
* Does not handle RewriteCond
* All existing parameters are appended to the new URL (the [QSA] flag is on by default)
* Any flag given is currently ignored