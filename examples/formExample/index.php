<?php
    if (isset($_REQUEST['submit'])) {
        print "Your data is " . $_REQUEST['name'] . " and email " . $_REQUEST['email'] . "<br>";
        print "<pre>" . var_export($_REQUEST, true) . "</pre>";
    }
?>
<form method="post" action="index.php" >
    <input type="hidden" name="multi[]" value="1" />
    <input type="hidden" name="multi[]" value="2" />
    Name: <input type="text" name="name"><br/>
    Email: <input type="text" name="email"><br/>
    <input type="submit" value="submit" name="submit">
</form>

<form enctype="multipart/form-data" method="post" action="index.php" >
    <input type="hidden" name="multi[]" value="1" />
    <input type="hidden" name="multi[]" value="2" />
    <input type="submit" value="submit2" name="submit">
</form>