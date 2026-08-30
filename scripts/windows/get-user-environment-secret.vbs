Set shell = WScript.CreateObject("WScript.Shell")
Set userEnvironment = shell.Environment("USER")
token = userEnvironment("OPENCLAW_GATEWAY_TOKEN")

If Len(token) = 0 Then
  WScript.Quit 1
End If

WScript.StdOut.Write token
