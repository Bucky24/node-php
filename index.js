const http = require('http');
const fs = require('fs');
const { exec } = require('child_process');
const path = require('path');
const url = require('url');

const cacheDir = path.join(__dirname, "cache");
if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir);
}

// https://stackoverflow.com/a/1349426/8346513
function makeid(length) {
    var result           = '';
    var characters       = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var charactersLength = characters.length;
    for ( var i = 0; i < length; i++ ) {
      result += characters.charAt(Math.floor(Math.random() * 
 charactersLength));
   }
   return result;
}

function serve(phpFile, port) {
    if (!fs.existsSync(phpFile)) {
        throw new Error(`Main php file ${phpFile} could not be found`);
    }
    const server = http.createServer((req, res) => {
        const resHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'OPTIONS, POST, GET, PATCH, DELETE, PUT',
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Max-Age': 2592000, // 30 days
        };

        //console.log(req.method);

        if (req.method === 'OPTIONS') {
            res.writeHead(204, resHeaders);
            res.end();
            return;
        }

        let requestData = '';
        req.on('data', chunk => {
            requestData += chunk.toString('utf8');
        })
        req.on('end', () => {
            const { headers, method } = req;
            //console.log(method);
            const urlObj = url.parse(req.url, true);
            //console.log(urlObj);

            if (urlObj.pathname === "/favicon.ico") {
                // 404 for now
                res.writeHead(404);
                res.end();
                return;
            }
            let body = null;
            if (requestData !== '') {
                const type = headers['content-type'];
                if (type === 'text/json') {
                    body = JSON.parse(requestData);
                }
                // handle this at some point by checking the content type header
            }
            //console.log(body);
            //console.log(requestData, urlObj);
            const cacheFile = makeid(12) + ".json";
            const cacheFilePath = path.join(cacheDir, cacheFile);
        
            const dataObject = {
                file: phpFile,
                query: urlObj.query,
                body,
            };
        
            fs.writeFileSync(cacheFilePath, JSON.stringify(dataObject));
        
            const command = `php ${path.join(__dirname, "php_runner.php")} ${cacheFilePath}`;
            //console.log(command);
            exec(command, (error, stdout, stderr) => {
                fs.unlinkSync(cacheFilePath);
                if (error) {
                    console.log("Got error from php runner:", error);
                    return;
                }

                if (stderr) {
                    console.log(stderr.trim());
                }
            
                //console.log(error, stdout, stderr);
                resHeaders['content-type'] = 'text/plain';
                //console.log(resHeaders);
                res.writeHead(200, resHeaders);
                res.end(stdout);
            });
        });
    });
    
    server.listen(port, () => {
        console.log('PHP capable server started on port ' + port);
    });
}

module.exports = serve;