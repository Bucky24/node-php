const serve = require('../../index');

serve(__dirname, 8080, null, null, {
    mimeOverrides: {
        mjs: 'text/javascript',
    },
});