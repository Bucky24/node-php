const serve = require('../../index');
const path = require('path');

serve(path.join(__dirname, "formExample.php"), 8080);