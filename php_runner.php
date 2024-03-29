<?php
	ini_set('display_errors', '0');
	ini_set('memory_limit','2168M');

    function handleErrorLogChanges() {
        $error_log_location = ini_get("error_log");
        if ($error_log_location !== (__DIR__ . "/error_log")) {
            $handle = fopen(__DIR__ . "/error_log", "a");
            fwrite($handle, date("[d-M-Y G:i:s e]") . " Error logs available at $error_log_location\n");
            fclose($handle);
        }
    }

    function fatal_handler() {
        $error = error_get_last();

        if($error !== NULL) {
            $errno   = $error["type"];
            $errfile = $error["file"];
            $errline = $error["line"];
            $errstr  = $error["message"];

            // write to the error log directly so we know for sure it actually gets
            // written.
            $handle = fopen(__DIR__ . "/error_log", "a");
            fwrite($handle, date("[d-M-Y G:i:s e]") . " Fatal error on line $errline in file $errfile: $errstr");
            fclose($handle);
        } else {
            // Someone ran exit or die
            handleErrorLogChanges();
        }
    }

    register_shutdown_function("fatal_handler");
	
	$file = getenv('QUERY_STRING');
    
    $data = file_get_contents($file);
    $data = json_decode($data, true);

    ini_set("error_log", __DIR__ . "/error_log");
    ini_set("log_errors", "on");

    chdir($data['baseDirectory']);
	set_include_path(get_include_path() . PATH_SEPARATOR . $data['baseDirectory']);
	$_SERVER['DOCUMENT_ROOT'] = $data['baseDirectory'];
	
	// php-cgi puts the calling script in as a request param and we don't want that
	$_REQUEST = array();
    
    if (array_key_exists("query", $data)) {
        foreach ($data['query'] as $key=>$value) {
            $_GET[$key] = $value;
            $_REQUEST[$key] = $value;
        }
    }
    
    if (array_key_exists("body", $data) && $data["body"] !== null) {
        foreach ($data['body'] as $key=>$value) {
            $_POST[$key] = $value;
            $_REQUEST[$key] = $value;
        }
    }
	
    foreach ($data['headers'] as $key=>$header) {
        if (strtolower($key) === "cookie") {
            $cookies = explode("; ", $header);
            foreach ($cookies as $cookie) {
                $cookieList = explode("=", $cookie);
                $_COOKIE[$cookieList[0]] = $cookieList[1];
            }
        } else if (strtolower($key) === 'referer') {
            $_SERVER['HTTP_REFERER'] = $header;
            continue;
        }
		
		$_SERVER[$key] = $header;
    }

    if (array_key_exists("request_uri", $data) && $data['request_uri'] !== null) {
        $_SERVER['REQUEST_URI'] = $data['request_uri'];
    }

    if (array_key_exists("files", $data) && $data['files'] !== null) {
        $_FILES = $data['files'];
    }
	
	if (array_key_exists("host", $data)) {
		$_SERVER['HTTP_HOST'] = $data['host'];
		$_SERVER['SERVER_NAME'] = $data['host'];
	}

    if (array_key_exists("method", $data)) {
        $_SERVER['REQUEST_METHOD'] = $data['method'];
    }
	
	$_SERVER['HTTPS'] = 'off';

    session_save_path($data['sessionPath']);
	
    include_once($data['file']);

    handleErrorLogChanges();
?>