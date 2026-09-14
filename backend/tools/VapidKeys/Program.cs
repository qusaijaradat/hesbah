using WebPush;

// VAPID keypair generator — run once, ever.
//
//     dotnet run --project backend/tools/VapidKeys
//
// The pair below identifies THIS server to Apple's, Google's and Mozilla's push services. The
// public half is baked into every subscription a phone creates, which is the whole reason this is
// a once-ever job: generating a second pair does not re-key the phones already subscribed, it
// orphans them. Every device would have to be switched on again by hand, and nobody would be told
// to — notifications would simply stop arriving, with nothing anywhere saying why.
//
// So: generate once, put them in the repository's production secrets, and keep a copy somewhere
// the market can find it. Never print the private key into a chat, a ticket or a log.

var keys = VapidHelper.GenerateVapidKeys();

Console.WriteLine();
Console.WriteLine("GitHub → Settings → Environments → production → Secrets:");
Console.WriteLine();
Console.WriteLine($"  VAPID_PUBLIC_KEY   {keys.PublicKey}");
Console.WriteLine($"  VAPID_PRIVATE_KEY  {keys.PrivateKey}");
Console.WriteLine();
Console.WriteLine("GitHub → Settings → Environments → production → Variables:");
Console.WriteLine();
Console.WriteLine("  VAPID_SUBJECT      mailto:you@example.com   (a real address — some push");
Console.WriteLine("                     services reject a push without one, and it is how an");
Console.WriteLine("                     operator reaches you when this server misbehaves)");
Console.WriteLine();
Console.WriteLine("Optional, with sensible defaults already applied:");
Console.WriteLine("  PUSH_TIMEZONE      Asia/Hebron");
Console.WriteLine("  PUSH_DAILY_HOUR    7");
Console.WriteLine();
Console.WriteLine("The private key is a secret. Do not commit it, and do not paste it anywhere");
Console.WriteLine("but the secrets store.");
Console.WriteLine();
