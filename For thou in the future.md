# For thou in the future

As of now, it is 28th November 2026, just after the gamefest tetrio event finished. 

First, I would like to thank my technical dpt team members Eve and Jayne for working together in this website. Without their efforts, I dont think this website will succeed.

There's a few things I want to point about like what we've worked on so far, what was our struggles and what further improvement you guys can implement into. 

So first of all, this repo is quite gigantuan. Like even looking at the architecture from https://gitdiagram.com/gdgoc-usm/gamefest-tetrio-2026 is crazy already.


## Why did we even make this website in the first place?
Well, we first were actually tasked to design a website where participants later can predict whether the player they vote for will win or not. So basically, the more correct predictions they make, the more points they gain, thus placing them higher in the leaderboard. In the meantime, they would also have a higher chance to win the lucky draw.


## Development journey
It was quite hard to start since we didn't have any reference. Honestly we didnt discuss seriously which is fine but it's really a game changer lah because we had to pick between two websites from Jayne and Eve. and then we agreed to decide to work on one that fits much better. Hm how to say ah. Its not that its bad, it's just that the alternative was much better in terms of functions and also simplicity UI. Involvement is more important is what I wanted to say.

Yeah...although we relied quite heavily on AI-assisted development, we still managed to make it a functionable website. Aye atleast its usable during the dday.

We worked on this website together using github by submitting github issues to suggest improvements, and also pull request to ask for other members to review your implementation.  

Oh ya the previous link was actually very similar to the new one
old: https://gamefest-tetrio-showdown.web.app/ (made by Eve)
new: https://gamefest-tetrio-2026.web.app/ (After I migrated it into github, and the firebase actually changes)


## D-Day experience
Since we couldnt test the prediction in a mass scale, we actually encountered a problem where after the users make a prediction, their name will be shown as "Participant". I think simply temporarily locking the prediction until they put in their full name would solve this problem. But what we did instead was manually change their name in the firebase database by tracing their user id, and see their profile name(based on their gmail acc) or simply their gmail prefix.  

For firebase spark plan(the free version), the daily usage is just 50k. The whole time we were monitoring the dashboard for that and eventually during lunch time it reached at 40k. Thankfully our supervisor was able to link his gcp billing acc to get the blaze plan. So even after 50k, its still able to run. Thats one thing

Oh ya another thing, theres only 2 people in charge of the website during the dday. Our initial plan was to just open/close predictions, publish winner results, Update the lucky draw participants like that. 

But for some reason because of that "participant" bug, everytime we close the prediction (While the players are playing), we would need to update their name from "Participants" to their actual full name. Having two people really sets a significant difference than only 1 that works on the website. aiyoo

u can actually see the 2026 results and also the firebase usage in the \docs\screenshots\dday-results


## UI/UX improvement advice:
> Currently, you can tell it's vibe coded right. Well perhaps have someone with a good taste that can test both in mobile and also desktop and see what they think about. Like what can you change so that first time user dont feel like "Ahhh what is this man" "Why is this so hard to move around" "It would be nice if they implement this". But ahhh, Im pretty sure AI that time would be so damn next level edy. Maybe dont "too much information" at one time. Let users see what they need to see. 

> The lucky draw wheel actually took a long time to spin, so maybe reduce that loading time? Test with 200 sample data. Like it would take around 10 seconds to finally spin. 


## Current bug:
Like what was mentioned during the 'dday experience' section. Im not sure whats causing them to be disconnected, like if they try to predict, they would show up as "Participant" in the leaderboard. 


## Future concerns:
I havent implemented any security measures to deal with people trying to hack into the admin account actually. Im not sure you guys will use the same database by firebase or different. I'll leave that up to you but just so you know, you never know what these cracked people is up to, maybe if they just wanna exploit or gain an advantage to win the lucky draw. 


## Advice to future batches
- Before modifying it, I suggest you to familiarise with the codebase before modifying it. Understand what it actually does.
- Please dont blindly trust AI-generated code
- Don't add features simply for the sake of adding features.
- Settle cloud billing arrangements early.
- Test the website under realistic conditions.
- Avoid introducing major changes right before D-Day.
- Always have a backup plan that does not depend on Firebase.
- Clearly distribute responsibilities among technical department members.
- Document your changes for the batch after yours.
- For the sake of the firebase usage, dont spam unnecessary recalculate functions (only use it when u need it)
- Bond with ur teammate bruu. It's not always you have a partner to work together with. 


## Personal closing
It's been a wild time to be in. I really hope you dont stress too much about the website. Especially if you feel like youre inexperienced, let it be something you'll take out the most of. 

lets strive together! Ill meet u at the top :)
<. technical dept gamefest tetrio showdown 2026