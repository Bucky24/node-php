<?php
    $file = $argv[1];
    
    $data = file_get_contents($file);
    $data = json_decode($data, true);
    
    //print_r($data);
    
    if (array_key_exists("query", $data)) {
        foreach ($data['query'] as $key=>$value) {
            $_GET[$key] = $value;
            $_REQUEST[$key] = $value;
        }
    }
    
    if (array_key_exists("body", $data)) {
        foreach ($data['body'] as $key=>$value) {
            $_POST[$key] = $value;
            $_REQUEST[$key] = $value;
        }
    }
    
    include_once($data['file']);
?>