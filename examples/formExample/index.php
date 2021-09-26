<?php
    if (isset($_REQUEST['submit'])) {
        print "Your data is " . $_REQUEST['name'] . " and email " . $_REQUEST['email'] . "<br>";
    }
?>
<form method="post" action="index.php">
    Name: <input type="text" name="name"><br/>
    Email: <input type="text" name="email"><br/>
    <input type="submit" value="submit" name="submit">
</form>