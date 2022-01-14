<?php
	ini_set('display_errors', '0');

	$metaData = array();

    function fatal_handler() {
        $error = error_get_last();

        if($error !== NULL) {
            $errno   = $error["type"];
            $errfile = $error["file"];
            $errline = $error["line"];
            $errstr  = $error["message"];

            error_log("Error on line $errline in file $errfile: $errstr");
        }
    }

    register_shutdown_function("fatal_handler");
	
	$file = getenv('QUERY_STRING');
    
    $data = file_get_contents($file);
    $data = json_decode($data, true);
    
    //print_r($data);

    chdir($data['baseDirectory']);
	set_include_path(get_include_path() . PATH_SEPARATOR . $data['baseDirectory']);
	$_SERVER['DOCUMENT_ROOT'] = $data['baseDirectory'];
    
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

    if (array_key_exists("request_uri", $data) && $data['request_uri'] !== null) {
        $_SERVER['REQUEST_URI'] = $data['request_uri'];
    }

    if (array_key_exists("files", $data) && $data['files'] !== null) {
        $_FILES = $data['files'];
    }
	
	if (array_key_exists("host", $data)) {
		$_SERVER['HTTP_HOST'] = $data['host'];
	}
	
	if (array_key_exists("sessionData", $data) && $data["sessionData"] !== null) {
        // this causes problems, need to do something better than this
		session_start();
		foreach ($data['sessionData'] as $key => $value) {
			$_SESSION[$key] = $value;
		}
	}

    if (!function_exists("getallheaders")) {
		function getallheaders() {
			global $data;
			return $data['headers'];
		}
	}
	
	ob_start();
    include_once($data['file']);
	$contents = ob_get_contents();
	ob_clean();
	
    if (isset($_SESSION)) {
        $metaData['session'] = $_SESSION;
    }
	
	print("----META----");
	
	print json_encode($metaData);
	
	print("----RESULT----");
	print($contents);
?>