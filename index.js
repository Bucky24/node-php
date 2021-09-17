const http = require('http');
const fs = require('fs');
const { exec } = require('child_process');
const path = require('path');
const urlParse = require('url');

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

function serve(directory, port) {
    if (!fs.existsSync(directory)) {
        throw new Error(`Main directory file ${directory} could not be found`);
    }
    
    function processUrl(url) {
        let obj = urlParse.parse(url, true);
        
        // check for htaccess
        const htaccessFile = path.join(directory, ".htaccess");
        
        if (fs.existsSync(htaccessFile)) {
            const contents = fs.readFileSync(htaccessFile, 'utf8');
            const contentList = contents.split("\n");
            
            // pretty bog-standard parser to fetch out the module groups
            const modules = [];
            let module = null;
            let moduleLines = [];
            for (const line of contentList) {
                if (!module) {
                    const matches = line.match(/\<IfModule (.+)\>/);
                    if (matches) {
                        module = matches[1];
                    }
                } else {
                    const matches = line.match(/\<\/IfModule\>/);
                    if (matches) {
                        modules.push({
                            module,
                            lines: moduleLines,
                        });
                        module = null;
                        moduleLines = [];
                    } else {
                        if (line.trim() !== '') {
                            moduleLines.push(line.trim());
                        }
                    }
                }
            }
            
            modules.forEach((module) => {
                if (module.module === "mod_rewrite.c") {
                    // look for all the rewrite rules
                    const rules = module.lines.filter((line) => {
                        return line.startsWith("RewriteRule");
                    });
                    // split the rules up and get data for them
                    rules.forEach((rule) => {
                        const ruleList = rule.split(" ");
                        // the first entry will always be the actual RewriteRule text
                        ruleList.splice(0, 1);
                        // realistically we shouldn't have spaces in the next regex because spaces are not valid in a URL, so the next entries are going to be the checker regex and the actual rewrite template
                        const regex = ruleList.splice(0, 1)[0];
                        const template = ruleList.splice(0, 1)[0];
                        // if we have anything left, it's the options
                        const options = ruleList.length > 0 ? ruleList[0] : null;
                        
                        // cut off the first slash, since mod_rewrite doesn't expect it
                        const pathname = obj.pathname.substr(1);

                        // attempt to match the regex
                        const matches = pathname.match(regex);
                        if (matches) {
                            // cut off the first entry, since everything else is going to be a match group
                            matches.splice(0, 1);
                            // build array of params for template
                            const params = matches.reduce((obj, match, index) => {
                                return {
                                    ...obj,
                                    [`\$${index+1}`]: match,
                                };
                            }, {});
                            
                            let newPathName = template;
                            Object.keys(params).forEach((key) => {
                                newPathName = newPathName.replace(key, params[key]);
                            });
                            
                            // rebuild and reprocess the url
                            let newUrl = newPathName;
                            if (obj.search && obj.search !== "?") {
                                if (newUrl.includes("?")) {
                                    // merge the old search with the new search
                                    newUrl += "&" + obj.search.substr(1);
                                } else {
                                    newUrl += obj.search;
                                }
                            }
                            
                            obj = urlParse.parse(newUrl, true);
                        }
                    });
                }
            });
        }
        
        return obj;
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
            const urlObj = processUrl(req.url);
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
                if (type === 'application/json') {
                    body = JSON.parse(requestData);
                } else if (type === "application/x-www-form-urlencoded") {
                    const requestList = requestData.split("&");
                    body = {};
                    for (const request of requestList) {
                        const [key, value] = request.split("=");
                        body[key] = decodeURIComponent(value);
                    }
                }
            }
            //console.log(body);
            //console.log(requestData, urlObj);
            const cacheFile = makeid(12) + ".json";
            const cacheFilePath = path.join(cacheDir, cacheFile);
            
            let phpFile = urlObj.pathname;
            if (phpFile === "/") {
                phpFile = "index.php";
            }
            
            const fullPhpPath = path.join(directory, phpFile);
            
            if (!fs.existsSync(fullPhpPath)) {
                res.writeHead(404);
                res.end();
                return;
            }
        
            const dataObject = {
                file: fullPhpPath,
                query: urlObj.query,
                body,
                // need to verify what PHP normally does here
                request_uri: urlObj.pathname,
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
                resHeaders['content-type'] = 'text/html';
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