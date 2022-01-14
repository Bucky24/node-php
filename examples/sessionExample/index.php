<?php

session_start();

if (!isset($_SESSION['counter'])) {
    $_SESSION['counter'] = 0;
} else {
    $_SESSION['counter'] ++;
}

print "You've seen this page " . $_SESSION['counter'] . " times!";

die();

?>