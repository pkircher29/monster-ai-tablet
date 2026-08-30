Set shell = WScript.CreateObject("WScript.Shell")
Set processEnvironment = shell.Environment("PROCESS")
Set userEnvironment = shell.Environment("USER")
token = processEnvironment("MAH_NEW_GATEWAY_TOKEN")

If Len(token) = 0 Then
  WScript.Echo "The temporary gateway token was not provided."
  WScript.Quit 1
End If

userEnvironment("OPENCLAW_GATEWAY_TOKEN") = token
