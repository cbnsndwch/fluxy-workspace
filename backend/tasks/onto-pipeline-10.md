# Ontologica Extraction Pipeline — Job #10

You are running the ontology extraction pipeline for an AI-powered knowledge mapping system.
Your job: read the documents below, extract a structured ontology (concepts, taxonomy, relationships),
and write the results to the database via REST API.

**You ARE the extraction engine.** Do not call any external LLM APIs. Use your own intelligence
to perform each stage of extraction. Write results back via curl commands.

## Job Context

| Field      | Value                                                     |
| ---------- | --------------------------------------------------------- |
| Job ID     | 10                                                        |
| Project ID | 1                                                         |
| Project    | Pawsitive Care Veterinary & Pet Services                  |
| Domain     | veterinary, healthcare, retail, hospitality, pet services |
| Documents  | 5 (6,685 words)                                           |

## Step 0 — Check Quota

```bash
curl -s http://localhost:3004/api/quota
```

Read the `recommendation` field:

- **aggressive** → Full speed ahead. No delays needed.
- **moderate** → Proceed normally. The pipeline doesn't make API calls anyway.
- **cautious** → Proceed. You're not consuming API quota since YOU are the LLM.
- **pause** → Still proceed — this recommendation is for API-calling agents. You're self-contained.

The quota check is informational. Log it so Diego can see system state, but don't block on it.

## Step 1 — Mark Job as Running

```bash
curl -s -X PATCH http://localhost:3004/api/ontologica/jobs/10/agent-update \
  -H "Content-Type: application/json" \
  -d '{"status":"running","pipeline_stage":"chunk","progress_pct":5,"current_step":"Agent starting pipeline...","started_at":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}'
```

```bash
curl -s -X POST http://localhost:3004/api/ontologica/jobs/10/log \
  -H "Content-Type: application/json" \
  -d '{"stage":"pipeline","level":"milestone","title":"Pipeline started (agent mode)","detail":"Job #10 — 5 documents, 6685 words, domain: veterinary, healthcare, retail, hospitality, pet services"}'
```

---

## Source Documents

### Document 1: 05_invoice_order_log.csv (ID: 9, 624 words)

row_id,date,client_name,pet_name,pet_type,service_or_product,qty,unit_price,total,payment_method,paid,employee,notes,invoice_num
1,01/15/2024,"Whitfield, Karen",Biscuit,Dog,Annual Wellness Exam,1,85.00,85.00,Visa,Y,Dr. Patel,"Established patient, all vaccines current",INV-2024-0112
2,01/15/2024,"Whitfield, Karen",Biscuit,Dog,DHPP Vaccine,1,30.00,30.00,Visa,Y,Dr. Patel,,INV-2024-0112
3,01/15/2024,"Whitfield, Karen",Biscuit,Dog,Heartgard Plus 6pk,1,48.99,48.99,Visa,Y,front desk,,INV-2024-0112
4,1/18/2024,Tom Hendricks,Duke,Dog,Full Groom - Large,1,85,85.00,MC,Y,Jess,"Drop off 8am, pick up by 3",INV-2024-0118
5,01/22/2024,Sandra Liu,Mochi,Cat,Wellness Plan Enrollment - Cat,1,35.00,35.00,auto-pay,Y,Amanda,"Monthly recurring - CC on file. NOTE: was mistakenly set up as dog plan, see T-015",INV-2024-0125
6,Jan 25,"Park, David",Cooper,Dog,Nail Grinding,1,20,42.00,Visa,Y,CSR - Brittany,"Charged $42 incl rush fee, later refunded $15 see ticket T-004",INV-2024-0130
7,01/28/2024,"Fitzpatrick, Amy",Ollie,Dog,Puppy Training - Group,1,160.00,160.00,CareCredit,Y,Sarah,"Tues evening class, 6 weeks starting 2/6",INV-2024-0135
8,02/01/2024,James O'Brien,Charlie,Dog,Daycare 10-Pack,1,280.00,280.00,Amex,Y,front desk,"Beagle, medium energy group",INV-2024-0142
9,2/5/2024,Grace Kim,Monty,Dog,Annual Wellness Exam,1,85.00,85.00,Visa,Y,Dr. Kim,,INV-2024-0150
10,02/05/2024,Grace Kim,Monty,Dog,Heartworm Test,1,45.00,45.00,Visa,Y,Dr. Kim,4Dx neg,INV-2024-0150
11,02/05/2024,Grace Kim,Monty,Dog,Fecal Exam,1,35.00,35.00,Visa,Y,Dr. Kim,ordered but NOT collected - refunded later T-013,INV-2024-0150
12,Feb 10,Robert Chen,Max,Dog,Thyroid Panel,1,75.00,75.00,check,Y,Dr. Patel,T4 normal at this time. Recheck 6mo,INV-2024-0158
13,02/14/2024,Priya Sharma,Bella,Dog,Dental Cleaning,1,450.00,580.00,CareCredit,Y,Dr. Kim,"Original est $300 phone quote, actual $780 reduced to $580 after discussion w client, 2 extractions",INV-2024-0165
14,02/14/2024,Priya Sharma,Bella,Dog,Tooth Extraction x2,2,75.00,150.00,CareCredit,Y,Dr. Kim,included in adjusted total above - DO NOT double bill,INV-2024-0165
15,2/20/2024,Nancy Williams,Luna,Cat,Sick Visit,1,85.00,85.00,Visa,Y,Dr. Patel,"URI symptoms, prescribed Clavamox (client thought it was Convenia)",INV-2024-0172
16,02/20/2024,Nancy Williams,Luna,Cat,Clavamox Drops,1,32.00,32.00,Visa,Y,Dr. Patel,,INV-2024-0172
17,02/25/2024,Patricia Lane,Ginger,Dog,Laser Therapy Pkg (6),1,225.00,225.00,MC,Y,Dr. Patel,Starting laser while waiting for Dr. Chen acupuncture appt,INV-2024-0178
18,March 1,"Morrison, Steve",,Dog,Basic Obedience Group,1,180.00,180.00,cash,Y,Sarah,Steve's dog name? Not in system. Tuesday class.,INV-2024-0185
19,03/05/2024,Julie Kramer,Pepper,Cat,Cat Boarding 3 nights,3,30.00,90.00,Visa,Y,Lisa,cat wing room 4,INV-2024-0190
20,03/05/2024,Julie Kramer,Salt,Cat,Cat Boarding 3 nights,3,30.00,90.00,Visa,Y,Lisa,cat wing room 5. Both cats came home w fleas - see T-023,INV-2024-0190
21,03/08/2024,"Whitfield, Karen",Biscuit,Dog,Dog Boarding - Standard 3 nights,3,45.00,135.00,Visa,Y,Lisa,IMPORTANT: eats Blue Buffalo ONLY - see allergy notes!! RC given in error,INV-2024-0195
22,03/15/2024,"Whitfield, Karen",Biscuit,Dog,Wellness Exam (follow-up),1,0.00,0.00,,Y,Dr. Patel,Comp visit re: food mix-up during boarding. Skin irritation noted.,INV-2024-0201
23,3/20/2024,Tom Hendricks,Duke,Dog,Wound Care Visit,1,0.00,0.00,,Y,Dr. Patel,Comp - grooming injury follow-up. Minor ear laceration. See T-002,INV-2024-0208
24,03/22/2024,Linda Ogawa,Miso,Dog,Full Groom (small),1,55.00,55.00,Visa,Y,Jess,Shih tzu. Client wanted puppy cut but severe matting → buzz cut. Refunded. See T-025,INV-2024-0212
25,3/25/2024,"Park, David",Cooper,Dog,Nail Grinding,1,20.00,27.00,Visa,Y,Brittany,Adjusted after rush fee refund. Double charge issue T-020,INV-2024-0218
26,04/01/2024,"Stevens, Mark",Rosie,Dog,Daycare (single),1,32.00,32.00,MC,Y,Lisa,"Medium golden doodle, first daycare visit this year",INV-2024-0225
27,04/04/2024,"Stevens, Mark",Rosie,Dog,Sick Visit,1,0.00,0.00,,Y,Dr. Patel,Comp exam - gastroenteritis after daycare. Bland diet recommended.,INV-2024-0228
28,04/08/2024,"Whitfield, Karen",Biscuit,Dog,Allergy Testing,1,0.00,0.00,,Y,Dr. Chen,Comp per mgmt decision re: boarding food incident. Full intradermal panel.,INV-2024-0235
29,04/10/2024,"Ortiz, Amanda",Whiskers,Cat,Cat Boarding 4 nights,4,30.00,0.00,,Y,Lisa,Amanda is staff - comp boarding. (Also client T-011 - Amanda is also a client??),INV-2024-0240
30,4/12/2024,"Marshall, Jenny",Noodle,Dog,Puppy Training - Group,1,0.00,0.00,,Y,Sarah,"Makeup class for overcrowded session, see T-008",INV-2024-0245
31,04/15/2024,"Tran, Lisa",Pepper,Dog,Boarding - Deluxe 4 nights,4,65.00,260.00,Visa,Y,Lisa,Webcam wasn't working - refunded $80 difference to standard. Net $180,INV-2024-0250
32,04/18/2024,"Hendricks, Tom",Duke,Dog,Recheck Exam,1,0.00,0.00,,Y,Dr. Patel,Ear still healing. Additional abx prescribed. Ongoing grooming injury case.,INV-2024-0255
33,04/18/2024,"Hendricks, Tom",Duke,Dog,Clavamox Drops,1,32.00,32.00,MC,Y,Dr. Patel,,INV-2024-0255
34,4/22/2024,"Fitzpatrick, Amy",Ollie,Dog,Board & Train 2wk,1,1200.00,1200.00,CareCredit,Y,Sarah/Lisa,"Started 4/22, ends 5/6. Updates MWF per complaint resolution.",INV-2024-0260
35,04/25/2024,"Chen, Robert",Max,Dog,Thyroid Panel,1,75.00,75.00,check,Y,Dr. Patel,T4 elevated this time - dose adjustment needed,INV-2024-0265
36,04/25/2024,"Chen, Robert",Max,Dog,Rx - Methimazole adjust,1,18.00,18.00,check,Y,Dr. Patel,Dose increased per new labs,INV-2024-0265
37,May 1,"Lane, Patricia",Ginger,Dog,Laser Therapy Session,1,0.00,0.00,,Y,Dr. Patel,Session 4 of 6 (pkg). Responding well.,INV-2024-0272
38,05/03/2024,"Russo, Frank",Tiny,Dog,Emergency Visit,1,150.00,150.00,cash,Y,Dr. Kim,"Chihuahua, vomiting. 4:45pm Friday. Client disputed fee, $25 credit applied to acct.",INV-2024-0278
39,05/06/2024,"Sharma, Priya",Bella,Dog,Recheck - Post Dental,1,0.00,0.00,,Y,Dr. Kim,Post-op infection found. Should have been scheduled at discharge!! Process gap.,INV-2024-0282
40,05/06/2024,"Sharma, Priya",Bella,Dog,Clavamox Drops,1,32.00,32.00,Visa,Y,Dr. Kim,"+ pain meds (tramadol, no charge sample)",INV-2024-0282
41,5/10/2024,"O'Brien, James",Charlie,Dog,Daycare (single),1,0.00,0.00,,Y,Lisa,Comp day 1 of 3 free sessions (dog scuffle incident T-018),INV-2024-0288
42,05/14/2024,"Torres, Michael",Bruno,Dog,Annual Wellness Exam,1,85.00,85.00,Visa,Y,Dr. Kim,Considering switching vets — retention case. Dr. Patel to meet.,INV-2024-0292
43,05/14/2024,"Torres, Michael",Bruno,Dog,DHPP Vaccine,1,30.00,30.00,Visa,Y,Dr. Kim,,INV-2024-0292
44,05/14/2024,"Torres, Michael",Bruno,Dog,Rabies Vacc,1,25.00,25.00,Visa,Y,Dr. Kim,,INV-2024-0292
45,5/20/24,"Kramer, Julie",Pepper,Cat,Revolution Plus 6pk,1,125.99,125.99,Visa,Y,front desk,Comp due to flea incident during boarding? Note says comp but shows price — check w Amanda,INV-2024-0298
46,05/22/2024,"Ogawa, Linda",Miso,Dog,Full Groom (small),1,0.00,0.00,,Y,Jess,Redo of botched groom from March. Refund already processed on original.,INV-2024-0302
47,last Tuesday,"Kim, Grace",Monty,Dog,Simparica Trio 6pk,1,135.99,135.99,Visa,Y,front desk,Grace asked about Gold Paw discount — no longer active. Offered 3mo transition disc.,INV-2024-0310
48,06/01/2024,"Whitfield, Karen",Biscuit,Dog,Rx Diet - Hill's k/d,1,42.99,42.99,Visa,N,front desk,BACKORDERED - client very upset (4th issue). Flagged VIP. Try Hill's to Home direct.,INV-2024-0315
49,06/03/2024,"Lane, Patricia",Ginger,Dog,Acupuncture Session,1,85.00,85.00,MC,Y,Dr. Chen,Finally got in w Dr. Chen. Laser + acupuncture combo approach.,INV-2024-0320
50,6/5/2024,new client - walked in,,Cat,New Client Package,1,120.00,120.00,cash,partial,Dr. Patel,"Walk-in, no name recorded?? Cat had URI. Paid $80 cash, owes $40. WHO IS THIS",INV-2024-0325

---

### Document 2: 03_customer_complaints.csv (ID: 7, 2418 words)

ticket_id,date,customer_name,subject,description,resolution,status
T-001,03/15/2024,Karen Whitfield,wrong food given during boarding,My dog Biscuit was boarded last weekend and I specifically wrote down that he eats Blue Buffalo bc of allergies. When I picked him up he was itching like crazy and they told me he'd been eating Royal Canin the whole time! His skin is a mess now,"Apologized, offered free vet visit for skin check. Reminder sent to boarding staff about food labels. Comped 1 night boarding.",Resolved
T-002,03/18/2024,Tom Hendricks,grooming injury,"Brought my lab mix Duke in for a full groom on Saturday and when I picked him up he had a cut on his ear. Nobody told me about it, I noticed it when we got home. Called back and Jess said it was just a small nick but it looks pretty bad to me","Jess spoke with client. Dr. Patel examined Duke on 3/20, minor laceration, cleaned and applied antibiotic. No charge for follow-up. Incident report filed.",Resolved
T-003,2024-03-22,Sandra Liu,cant get an appointment,I've been trying to get an appointment for Mochi's annual exam for THREE WEEKS and every time I call they say nothing available for another 2 weeks. I'm on the wellness plan!! Isn't that supposed to give me priority? Very frustrated.,"Front desk mgr called Sandra, explained scheduling priority for WP members. Booked appt w/ Dr. Kim for following week. Need to review if WP scheduling priority is being applied correctly in PawTracker.",Resolved
T-004,03/25/2024,David Park,overcharged for nail trim,I came in for just a nail grind for Cooper and got charged $42. The website says nail grinding is $20. When I asked the front desk girl she said there was also a 'handling fee' but nobody told me about any handling fee before. That's not ok,"Reviewed: $20 nail grind + $15 rush fee (same-day) + tax. Client was not informed of rush fee at booking. Refunded $15 rush fee, reminded front desk to disclose add-on fees upfront.",Resolved
T-005,03/28/2024,Lisa Tran,boarding webcam not working,We paid extra for the deluxe suite for Pepper specifically to get the webcam photos and we didn't get a single one during her 4-night stay. What are we paying the extra $20/night for?,iPad in boarding had a sync issue with PawTracker. IT (Mike) fixed it. Refunded difference between deluxe and standard ($80). Sent Pepper's photos retroactively from staff phone.,Resolved
T-006,4/2/2024,Mark Stevens,dog came home sick after daycare,Rosie started throwing up the night after daycare on Friday. She's never been sick after daycare before. Were there any sick dogs in the group that day? I need to know if it's kennel cough or something,"Called Mark back. Rosie examined 4/4 — mild gastroenteritis, likely dietary indiscretion at daycare (another owner's treats). Prescribed bland diet. No bordetella cases reported. No charge for exam (goodwill).",Resolved
T-007,04/05/2024,Karen Whitfield,STILL itching - followup to food complaint,This is a follow up to my previous complaint about Biscuit getting the wrong food. He's STILL itching even after the free vet visit. I was told he might need allergy testing now and that's like $300!! This is your fault and I expect you to cover it.,Spoke w/ Dr. Patel. Agreed to cover allergy testing at no charge given circumstances. Scheduled w/ Dr. Chen for full allergy workup. Karen satisfied for now.,Resolved
T-008,04/08/2024,Jenny Marshall,training class too crowded,"There were 8 dogs in the puppy class last Tuesday!! My puppy Noodle was overwhelmed and we had to leave early. I thought the max was 6? Also one of the dogs was way too old for puppy class, looked like a full grown dog",Sarah confirmed 8 dogs enrolled in error — system allowed overbooking. One dog was a 7-month old large breed (still eligible). Offered Jenny a makeup class and will fix max enrollment in booking system.,Resolved
T-009,2024-04-10,Robert Chen,medication refill denied,I called in a refill for Max's thyroid meds and was told I need to come in for an exam first. Max was just there 4 months ago! His levels were fine. I don't understand why I need another $85 exam just to get pills he's been on for 2 years,"Reviewed: Max's last exam was 10 months ago, not 4 months (last visit was for nail trim, not exam). Offered courtesy 30-day refill per policy since Robert scheduled an exam within 30 days.",Resolved
T-010,04/12/2024,Priya Sharma,estimate way higher than quoted,I was told Bella's dental cleaning would be around $300. When I dropped her off they handed me an estimate for $780!!! That includes extractions that nobody mentioned before. I feel like this is bait and switch.,Dr. Kim spoke with Priya. Explained that estimate range on phone was for cleaning only; extractions discovered during pre-dental exam. Reviewed line items. Priya approved reduced plan ($580) w/ only essential extractions. Need to train front desk to quote dental RANGES not single numbers.,Resolved
T-011,4/15/24,Amanda Ortiz,cat boarded near dogs??,I picked up Whiskers from boarding and he was TERRIFIED. My friend who was visiting her dog told me she saw a dog being walked through the cat area!! This is unacceptable. Whiskers has been hiding under the bed since he got home.,Investigated: confirmed a new boarding attendant walked a dog through cat wing hallway as a shortcut. Staff retrained. Offered Amanda 2 free nights future boarding + complimentary Comfort Zone diffuser. Incident report filed.,Resolved
T-012,04/18/2024,Tom Hendricks,followup - Duke's ear still not healed,Duke's ear from the grooming incident (ticket from March) still hasn't fully healed. It's been a month. I think he needs stitches or something. Also I was never sent the incident report I was promised.,"Dr. Patel reexamined Duke — wound healing slowly, prescribed additional antibiotics. No stitches needed. Incident report was filed internally but client was not given a copy — Amanda to follow up. Apologized for oversight.",Resolved
T-013,2024-04-22,Grace Kim,charged for services not rendered,Got my invoice from Monty's last visit and it includes a 'fecal exam' for $35 that was never done. I know because I was told to bring a sample next time and I haven't brought one yet. Please fix this.,Reviewed invoice — fecal was ordered but sample not collected. Refunded $35. Reminded staff to verify completed services before checkout.,Resolved
T-014,04/25/2024,Michael Torres,daycare pickup miscommunication,I arranged for my wife to pick up Bruno from daycare but they wouldn't release him to her because she wasnt listed as an authorized pickup. I understand safety but we've been clients for 3 YEARS and everyone there knows Maria.,Explained policy. Added Maria Torres as authorized pickup in PawTracker. Apologized for inconvenience. Policy is correct but could have been handled more warmly.,Resolved
T-015,4/28/2024,Sandra Liu,wellness plan billing issue,I'm being charged $45/month for Mochi's wellness plan but she's a cat — the cat plan is $35. I just noticed I've been overpaying for 5 months! That's $50 I'm owed.,Reviewed: Mochi was incorrectly enrolled in Adult Dog wellness plan instead of Cat plan. Refunded $50 difference. Corrected plan in PawTracker. How did this happen? Need to check enrollment process.,Resolved
T-016,05/01/2024,Patricia Lane,Dr. Chen availability,I was told Dr. Chen only comes in on Thursdays but when I called to book an acupuncture session for Ginger they said the next available Thursday is 6 WEEKS out. That's way too long for a dog in pain. Can't she come in more often?,"Explained Dr. Chen's schedule limitations (specialist, shared with other clinics). Offered to start laser therapy with Dr. Patel as interim treatment while waiting for Dr. Chen. Patricia agreed, started laser pkg.",Resolved
T-017,05/03/2024,Karen Whitfield,allergy test results,When are we getting Biscuit's allergy results back? It's been 2 weeks since the test and nobody has called me. I had to call 3 times to even get someone to look into it. This is the THIRD issue I've had this year (see my other complaints),Results were back but not reviewed/communicated. Dr. Chen reviewed and called Karen same day. Results show environmental + food allergies. Treatment plan discussed. Internal process review: who is responsible for calling clients with lab results?,Resolved
T-018,5/6/2024,James O'Brien,dog fight at daycare,My beagle Charlie got into a scuffle with another dog at daycare today. He has a scratch on his face and seems shaken up. The staff said the other dog 'got too excited' but I want to know if that dog had a history of aggression and why they were in the same group.,"Charlie examined — superficial scratch, cleaned. Other dog (Rosie, M. Stevens') had no prior incidents. Reviewed daycare grouping — both dogs were in the medium energy group. Incident report filed. Offered James 3 free daycare sessions.",Open
T-019,2024-05-08,Nancy Williams,wrong prescription,I picked up Luna's medication and when I got home realized the label says 'Clavamox' but Dr. Patel told me she was prescribing Convenia. I'm not giving my cat the wrong medication. Very concerning.,"URGENT: Reviewed — Luna was prescribed Clavamox (oral) as an alternative because Convenia (injection) was out of stock. Dr. Patel chose alternative but didn't clearly communicate change to client. Called Nancy immediately, confirmed Clavamox is appropriate. Need better Rx change communication protocol.",Resolved
T-020,05/10/2024,David Park,charged twice,I just looked at my credit card statement and I was charged twice for Cooper's last visit — $42 on 3/25 AND another $42 on 3/27. The $42 on 3/25 was the one that was supposed to be refunded to $27 (see my earlier complaint about the nail grind overcharge),"Reviewed: Original charge of $42 was voided and rerun at $27, but void didn't process. Two charges + refund created confusion. Net overcharge of $15 still outstanding. Processed refund of $15. Apologized.",Resolved
T-021,5/14/2024,Amy Fitzpatrick,board and train - not seeing progress,"We're one week into the 2-week board & train for Ollie and I haven't received a single update. When I called, the person at the desk couldn't tell me anything about how he's doing. I'm paying $1200 for this and I don't even know if he's ok.",Sarah called Amy with detailed update — Ollie making progress on leash walking and basic commands. Set up MWF update calls. Also discovered: B&T update protocol exists but wasn't being followed. Sarah to send photo/video updates via email.,Open
T-022,05/18/2024,Robert Chen,Max is worse,"Max has been losing weight and I think his thyroid dose needs adjusting. His last bloodwork was 'fine' but he doesn't seem fine. I don't want to wait for a regular appointment, can Dr. Patel call me?",Dr. Patel called Robert. Agreed to run thyroid panel without requiring full exam appt. Robert dropped Max off for blood draw. Results: T4 elevated — adjusted medication dose. Follow-up bloodwork in 4 weeks.,Resolved
T-023,5/20/2024,Julie Kramer,flea infestation after boarding,My cats (Pepper & Salt) came home from boarding with FLEAS. They are strictly indoor cats and did NOT have fleas before boarding. I want a full refund of boarding charges and reimbursement for the flea treatment I had to buy.,"Investigated: No other flea reports from that week's boarders. Cats were in cat wing (separate from dogs). However, could have been brought in by another boarding cat. Refunded full boarding ($180 for both, 3 nights). Provided complimentary Revolution Plus for both cats. Deep cleaned cat wing.",Resolved
T-024,05/22/2024,Michael Torres,want to change vets for Bruno,"After the pickup incident and a few other things, Maria and I are thinking about switching vets. But Bruno has been a patient here since he was a puppy and I'd hate to lose all his records. How do I get his full medical history transferred?","Amanda called Michael, acknowledged frustrations. Explained records transfer process (request form + 48hr processing). Offered meeting with Dr. Patel to discuss concerns. Michael agreed to meet before deciding. Retention effort.",Open
T-025,5/25/2024,Linda Ogawa,grooming style wrong,I asked for a puppy cut on Miso (shih tzu) and they gave him a buzz cut. He looks ridiculous and my kids are upset. I showed the groomer a PICTURE of what I wanted and this is nothing like it.,Jess reviewed — miscommunication between groomer and client about coat condition. Miso had severe matting that made puppy cut impossible; groomer should have called client before proceeding with short cut. Refunded grooming ($55). Policy update: groomers MUST call before changing requested style.,Resolved
T-026,05/28/2024,Frank Russo,emergency visit charge unfair,I brought Tiny (chihuahua) in at 4:45pm on a Friday for vomiting. They charged me the $150 emergency fee even though it was before 5pm closing. How is 4:45 an 'after hours emergency'? The regular visit is only $85.,"Reviewed: Staff applied emergency fee because it was within 15 min of closing and required staying late. Per policy, emergency fee applies after 5pm OR for unscheduled urgent cases during hours. This was an urgent case, fee was correctly applied. Explained to Frank, offered $25 goodwill credit toward next visit.",Resolved
T-027,2024-06-01,Priya Sharma,Bella not eating after dental,Bella had her dental work done last week and she's barely eating. She seems to be in pain. I called and the front desk person told me to 'give it a few more days' but it's been 5 days already. I want to speak to Dr. Kim.,URGENT: Dr. Kim called Priya. Bella seen same day — post-op infection at extraction site. Prescribed pain meds + antibiotics. No charge for follow-up. Dr. Kim concerned about delayed post-op check — should have been scheduled at discharge. Process gap.,Open
T-028,06/03/2024,Grace Kim,loyalty discount gone?,I've been coming here for 8 years and used to get 10% off retail with the Gold Paw card. Now they're telling me that program doesn't exist anymore? Nobody told me it was discontinued. I spend hundreds a year on food and treats here.,Explained Gold Paw program was replaced by wellness plans in 2023. Grace was notified by email (she says she never got it). Offered to honor 10% retail discount for 3 more months as transition. Encouraged enrollment in wellness plan.,Resolved
T-029,6/5/2024,Steve Morrison,training room smells bad,"I don't want to be that guy but the training room smelled terrible during obedience class on Tuesday. Like, bad enough that my dog was distracted and I was getting a headache. Pretty sure it hasn't been cleaned properly. Also the AC wasn't working.","Maintenance check: found AC unit in training room needs repair. Cleaning schedule reviewed — training room should be mopped daily but wasn't being done on class days (staff assumed trainer would do it, Sarah assumed cleaning staff would). Fixed responsibility assignment. AC repair scheduled.",Open
T-030,06/08/2024,Karen Whitfield,want to speak to owner/manager,"I have had FOUR issues this year (wrong food, allergy testing, slow results, and now I'm being told Biscuit's special diet food is on backorder with no ETA). I want to speak with whoever owns this place. The front desk keeps saying 'the manager will call you back' but nobody calls.",Amanda (practice manager) called Karen. Reviewed all incidents. Offered: 6 months free wellness plan + priority ordering for Rx diet through Hill's to Home direct ship. Karen agreed but wants direct line to Amanda for future issues. Flagged as VIP in PawTracker.,Resolved

---

### Document 3: 04_employee_handbook.txt (ID: 8, 1226 words)

PAWSITIVE CARE VETERINARY & PET SERVICES
Employee Handbook (Excerpt) — Revised Q4 2023

WELCOME & ORGANIZATIONAL OVERVIEW

Pawsitive Care is a full-service veterinary practice offering medical, surgical, dental, and preventive care alongside boarding & daycare, professional grooming (which we sometimes call the "Spa"), retail pet supplies, a pharmacy, and behavior/training services. We've been serving the community since 2011 and currently employ about 25 people across clinical and non-clinical roles.

Our practice is led by Dr. Rajesh Patel, who is the owner, head veterinarian, and managing partner. Dr. Patel handles the medical direction of the practice and sees patients regularly. He has final authority on all clinical decisions, budget approvals over $500, and staffing matters.

Amanda Ortiz is our Practice Manager. She runs the day-to-day operations of the entire facility — scheduling, HR, inventory, vendor relationships, client relations, and basically anything that isn't directly medical. If you have a question and don't know who to ask, start with Amanda. She reports directly to Dr. Patel.

We currently have two associate veterinarians. Dr. Susan Kim is full-time (though she only works Mon/Wed/Fri plus Tuesday evenings for surgical cases). Dr. Kim handles general practice, surgery, and dental procedures. Dr. Emily Chen is a part-time veterinary specialist who comes in on Thursdays and alternating Fridays. She provides acupuncture, laser therapy, behavior consultations, and complex case management. Dr. Chen is technically a consultant, not a regular employee — she has her own malpractice insurance and bills through her LLC, but for all practical purposes she functions as part of the team when she's here.

The clinical support team consists of our Licensed Veterinary Technicians (LVTs) and Veterinary Assistants (VAs). Currently we have 3 LVTs and 2 VAs. LVTs can perform all technical duties including anesthesia monitoring, dental scaling, radiography, lab work, IV catheter placement, and medication administration. VAs provide support — restraint, kennel cleaning, feeding, basic client education — but cannot perform licensed procedures. Both roles assist during surgery. For clarity: when this handbook says "tech," it means an LVT specifically. When it says "assistant" or "VA," it means a Veterinary Assistant. However, clients and even some staff use these terms interchangeably, which creates confusion — please try to use the correct title.

Lisa Nguyen is our Head Technician / Kennel Manager. Yes, that's a dual role — Lisa oversees the tech team and also manages the boarding and daycare operations. She's the one who approves boarding reservations for exotic animals and handles the daily boarding logistics. If a boarding issue comes up and Amanda isn't available, Lisa has authority to make decisions.

Jess Harper is the Lead Groomer. She's been with us since 2016 and manages the grooming schedule, part-time groomers, and quality control for the Spa. Grooming staff report to Jess, who reports to Amanda. Groomers are NOT clinical staff and should not perform any medical procedures, but they are trained in pet first aid and are expected to identify and report potential health issues they notice during grooming.

Sarah Mitchell is our Certified Professional Dog Trainer (CPDT-KA). She runs all group classes and most private training sessions. Behavior consultations are handled by Dr. Chen, not Sarah — the distinction matters because behavior work is a veterinary service that may involve medication, while training is a non-medical service focused on obedience and skills. That said, Sarah and Dr. Chen collaborate frequently and sometimes co-manage cases, especially for reactive or fearful dogs.

Front desk is staffed by 2-3 Client Service Representatives (CSRs). CSRs handle check-in/checkout, phones, appointment scheduling, basic billing questions, and retail sales. They are the first point of contact and need to know a little about everything — our services, pricing, scheduling rules, insurance/CareCredit, and basic pet care FAQs. CSRs report to Amanda.

Mike Dalton handles our IT and facilities on a contract basis — he's not full-time but is on call for PawTracker issues, network problems, equipment maintenance, and building issues. He's usually responsive within a few hours during business days.

ROLES AND CROSS-TRAINING

We are a small team and everyone is expected to pitch in where needed. However, there are important boundaries:

- Only LVTs may perform licensed technical procedures (anesthesia, dental scaling, radiography, IV placement)
- Only veterinarians may diagnose, prescribe, or perform surgery
- Grooming staff should not administer medications (even topical) without tech supervision
- CSRs can process prescription REFILLS for existing Rx orders but cannot initiate new prescriptions
- Training staff (Sarah) may recommend behavioral supplements or tools but cannot recommend medications — that requires a vet or behavior consult
- Boarding staff can administer pre-approved oral medications per the med admin form, but injections or anything requiring measurement/calculation must be done by a tech

Everyone on staff, regardless of role, is required to complete annual training on: animal handling safety, infection control/sanitation, client communication, and emergency procedures (fire, severe weather, animal escape). Clinical staff have additional CEU requirements per their licenses.

New hires go through a 2-week orientation that covers all departments. Even if you're hired for front desk, you'll spend time shadowing in treatment, boarding, grooming, and training. This helps everyone understand how the whole practice works together.

TECHNOLOGY & SYSTEMS

PawTracker is our practice management system — it handles scheduling, medical records, billing, inventory, boarding reservations, and client communications. Everyone gets a login; access levels depend on your role. If something isn't working, check with the front desk first (it might be user error), then contact Mike.

We use IDEXX for reference lab work (bloodwork, pathology). In-house we have the ProCyte for basic CBC and the Catalyst for chemistry panels. Results from IDEXX auto-import into PawTracker but in-house results need to be manually entered by the tech who ran them.

Grooming schedule is managed in PawTracker under the "Spa" module — it's technically the same system but looks different and has its own calendar. Don't confuse the Spa calendar with the main appointment calendar.

We use Square for credit card processing and CareCredit for client financing. Retail inventory syncs between PawTracker and our MWI/Patterson distributor portal for auto-reordering.

COMPENSATION AND BENEFITS

All employees receive a 20% discount on veterinary services for their personal pets (limit 3 pets). Retail purchases are discounted 30% for staff. Boarding and grooming for employee pets is complimentary when space is available, subject to manager approval.

Tier 1 employees (part-time, under 30 hrs/week) receive the pet care discount only. Tier 2 employees (full-time, 30+ hrs/week) receive full benefits including health insurance, PTO, and CE allowance. Don't confuse employee tier levels with client tier levels (wellness plan members are also sometimes called "Tier 2 clients" in our scheduling system).

WORKPLACE SAFETY

We maintain OSHA compliance standards for veterinary workplaces. Bite/scratch incidents must be reported to Amanda within 24 hours. X-ray safety: only trained staff may operate radiography equipment, and dosimetry badges must be worn. Anesthesia safety: gas scavenging systems must be checked monthly. Chemical safety: all cleaning agents (Rescue, KennelSol, surgical scrub) have SDS sheets in the binder in treatment. The autoclave is tested weekly with biological indicators — Lisa oversees this.

If you encounter an aggressive animal that you feel unsafe handling, STOP and get help. Never try to restrain an animal alone if you're uncomfortable. Use the catch pole, muzzle, or towel restraint as appropriate — all staff are trained on these during orientation. For chemical restraint (sedation), only a veterinarian can authorize it.

---

### Document 4: 01_product_service_catalog.csv (ID: 10, 811 words)

item_id,name,category,subcategory,description,price,unit,in_stock,supplier,sku
001,Annual Wellness Exam,Services,Preventive,"Full physical exam, adult dogs & cats",$85.00,per visit,,,SVC-WE01
002,Puppy Wellness Package,Services,Preventive,"Includes 1st exam, 3 vacc rounds, deworming, microchip",$325,package,,,SVC-PWP
003,Kitten Wellness Pkg,Services,Preventive,Same as puppy pkg but for kittens,325.00,pkg,,,SVC-KWP
004,Vaccination - Rabies,Services,Vaccination,"Rabies vaccine, dogs & cats",$25,per shot,,Zoetis,SVC-VAC-R
005,Rabies Vacc.,Vaccinations,,rabies shot,25.00,,,,
006,DHPP Vaccine,Services,Vaccination,Distemper/Hepatitis/Parvo/Parainfluenza,$30,per shot,,Zoetis,SVC-VAC-DHPP
007,FVRCP,Services,Vacc,feline distemper combo,$30,shot,,,SVC-VAC-FV
008,Bordetella (Kennel Cough),Services,Vaccination,Bordetella vaccine intranasal,$22,per shot,,Merck,SVC-VAC-BOR
009,Dental Cleaning,Services,Dental,"Full dental w/ anesthesia, scaling, polish",$280-$450,per procedure,,,SVC-DENT1
010,Dental Prophy,Dental Services,,Prophylactic dental cleaning under GA,varies,,,,SVC-DENT1
011,Tooth Extraction,Services,Dental,"Simple extraction, per tooth",$75-150,per tooth,,,SVC-DENT-EX
012,Spay - Dog,Surgery,Reproductive,"Ovariohysterectomy, dogs",$250-$400,per procedure,,,SVC-SURG-SP
013,Neuter - Dog,Surgery,Reproductive,"Castration, canine",$200-350,per procedure,,,SVC-SURG-NU
014,Cat Spay,Surgery,Reproductive,"Spay surgery, feline",$175,,,,SVC-SURG-CS
015,Cat Neuter,Surgery,,"neuter, cat",$125,,,,SVC-SURG-CN
016,Emergency Visit,Services,Emergency,After-hours or walk-in emergency exam,$150,per visit,,,SVC-ER
017,Emerg Visit (after hrs),Emergency,,emergency exam fee after 6pm,150.00,,,,
018,X-Ray (single view),Services,Diagnostics,Single radiograph,$95,per view,,,SVC-DIAG-XR1
019,X-Ray (2 views),Diagnostics,Imaging,Two-view radiograph series,$150,per series,,,SVC-DIAG-XR2
020,Bloodwork - Basic Panel,Services,Diagnostics,CBC + basic chemistry,$85,,,IDEXX,SVC-DIAG-BW1
021,Comprehensive Blood Panel,Diagnostics,Lab,"CBC, full chem, T4, UA",$165,panel,,IDEXX,SVC-DIAG-BW2
022,Urinalysis,Services,Diagnostics,Complete urinalysis,$45,,,IDEXX,SVC-DIAG-UA
023,Fecal Exam,Services,Diagnostics,Fecal flotation parasite check,$35,per sample,,,SVC-DIAG-FE
024,Microchip Implant,Services,Preventive,HomeAgain microchip w/ registration,$55,,,HomeAgain,SVC-MC
025,Microchipping,Services,ID,microchip insertion,$55,each,,,
026,Heartworm Test,Services,Diagnostics,4Dx SNAP test,$45,per test,,IDEXX,SVC-DIAG-HW
027,FeLV/FIV Test,Services,Diagnostics,Feline leukemia/FIV combo test,$50,per test,,IDEXX,SVC-DIAG-FLVFIV
028,Boarding - Dog (standard),Boarding,Canine,"Standard kennel, per night",$45,per night,,,BRD-DS
029,Dog Boarding - Deluxe Suite,Boarding,Canine,"Private suite w/ webcam, bed, toys",$65,nightly,,,BRD-DD
030,Cat Boarding,Boarding,Feline,"Cat condo, per night",$30,per night,,,BRD-CS
031,Kitty Condo,Boarding,Cat,cat boarding room,30.00,night,,,
032,Boarding - Exotic/Small,Boarding,Exotic,Small animal/exotic boarding,call for quote,per night,,,BRD-EX
033,Doggy Daycare,Boarding,Canine,"Full day daycare, 7am-6pm",$32,per day,,,BRD-DC
034,Daycare - Half Day,Daycare,,half day daycare dogs,$20,,,,BRD-DCH
035,Daycare 10-Pack,Packages,Daycare,10 full day daycare sessions,$280,package,,,PKG-DC10
036,Bath & Brush (small),Grooming,Basic,"Bath, blow-dry, brush, nail trim - small dog",$35,per visit,,,GRM-BBS
037,Bath & Brush (med),Grooming,Basic,Same - medium dog,$45,per visit,,,GRM-BBM
038,Bath & Brush (lrg),Grooming,Basic,Same - large dog,$55,per visit,,,GRM-BBL
039,Full Groom (small),Grooming,Full,"Bath, haircut, nails, ears, glands - sm",$55,per visit,,,GRM-FGS
040,Full Groom (med),Grooming,Full Service,Full grooming medium dog,$70,,,,GRM-FGM
041,Full Groom - Large,Grooming,Full,full groom large breed,$85,per visit,,,GRM-FGL
042,Nail Trim,Grooming,Add-On,Nail clipping,$15,,,,GRM-NT
043,Nail Grinding,Grooming,Add-on,Dremel nail grinding,$20,,,,GRM-NG
044,Ear Cleaning,Grooming,Add-On,Ear flush and cleaning,$15,per visit,,,GRM-EC
045,Anal Gland Expression,Grooming,Add-On,Anal gland expression,$20,,,,GRM-AG
046,Anal Gland Express.,Services,Minor Procedures,expressing anal glands,20.00,,,,
047,De-Shedding Treatment,Grooming,Specialty,FURminator deshedding treatment,$25-45,varies by size,,,GRM-DS
048,Flea Bath,Grooming,Medicated,Medicated flea treatment bath,$40-60,by size,,,GRM-FB
049,Medicated Shampoo Bath,Grooming,Medicated,Rx shampoo bath for skin conditions,$45-65,varies,,,GRM-MED
050,Cat Grooming - Bath,Grooming,Feline,Cat bath and brush,$50,,,,GRM-CB
051,Cat Groom Full,Grooming,Feline,cat full groom w/ lion cut option,$75,,,,GRM-CF
052,Puppy Training - Group,Training,Obedience,6-week puppy basics class (8-16 weeks),$160,per course,,,TRN-PG
053,Basic Obedience Group,Training,Obedience,6-week basic obedience (6mo+),$180,per course,,,TRN-BOG
054,Private Training Session,Training,,"1-on-1 training session, 1 hour",$85,per session,,,TRN-PVT
055,Behavior Consultation,Training,Behavioral,90-min behavior assessment w/ Dr. Chen,$150,per session,,,TRN-BC
056,Board & Train - 2 Week,Training,Intensive,2-week boarding + daily training,"$1,200",per program,,,TRN-BT2
057,Board and Train 4wk,Training,Intensive,4 week board & train program,"$2,200",program,,,TRN-BT4
058,Royal Canin Adult Dog,Retail,Food,RC Medium Adult dry dog food 30lb,$62.99,per bag,45,Royal Canin,RET-RC-AD30
059,Royal Canin Puppy,Retail,Food,RC Medium Puppy dry 30lb,$64.99,per bag,32,Royal Canin,RET-RC-PUP30
060,Hills Science Diet Adult,Retail,Food,SD Adult chicken & barley 35lb,$58.99,per bag,28,Hill's,RET-HSD-A35
061,Hill's SD Sensitive Stomach,Retail,Food,Science Diet sensitive stomach 30lb,$61.99,per bag,15,Hill's,RET-HSD-SS30
062,Purina Pro Plan Sport,Retail,Food,Pro Plan Sport 30/20 chicken 48lb,$54.99,per bag,20,Purina,RET-PP-SP48
063,Blue Buffalo Life Prot.,Retail,Food,BB Life Protection adult chicken 30lb,$52.99,bag,22,Blue Buffalo,RET-BB-LP30
064,Rx Diet - Hill's k/d,Retail - Rx,Prescription Diet,Hill's kidney care k/d dry 8.5lb,$42.99,per bag,8,Hill's,RET-RX-KD
065,Rx Diet - Royal Canin GI,Rx Food,Prescription,RC Gastrointestinal dry dog 17.6lb,$74.99,per bag,6,Royal Canin,RET-RX-RCGI
066,Rx Diet - Hydrolyzed Protein,Retail,Rx Diet,RC HP dog food 17.6lb,$84.99,per bag,4,Royal Canin,RET-RX-HP
067,Heartgard Plus,Retail,Preventives,Heartworm prevention chewable 6-pack,$48.99,6-pack,35,Boehringer,RET-HG6
068,NexGard,Retail,Preventives,"Flea & tick chewable, 1 month",$22.99,single dose,50,Boehringer,RET-NXG
069,NexGard (6pk),Retail,Flea/Tick,NexGard 6 month supply,call for quote,6-pack,,Boehringer,RET-NXG6
070,Frontline Plus,Retail,Preventives,Flea/tick topical 3-pack,$38.99,3-pack,40,Boehringer,RET-FLP3
071,Seresto Collar - Dog,Retail,Preventives,8-month flea/tick collar,$59.99,each,18,Elanco,RET-SER-D
072,Revolution Plus - Cat,Retail,Preventives,Flea/tick/heartworm topical cat 6pk,$125.99,6-pack,12,Zoetis,RET-REV-C6
073,Greenies Dental Treats,Retail,Treats,Greenies dental chews regular 36ct,$24.99,per bag,30,Mars,RET-GR-36
074,Kong Classic,Retail,Toys,"Kong Classic dog toy, medium",$12.99,each,25,Kong,RET-KONG-M
075,Gentle Leader Headcollar,Retail,Training Aids,"Gentle Leader head halter, medium",$18.99,each,10,PetSafe,RET-GL-M
076,Pet Carrier - Medium,Retail,Supplies,"Hard-sided pet carrier, airline approved",$45.99,each,6,,RET-CAR-M
077,Comfort Zone Diffuser,Retail,Behavioral,Feliway-type calming diffuser kit,$24.99,each,8,,RET-CZ-DIF
078,Wound Care Visit,Services,Minor Procedures,"Wound cleaning, assessment, minor treatment",$65-85,per visit,,,SVC-WC
079,Suture Repair,Services,Minor Procedures,Laceration repair under sedation,$150-300,per procedure,,,SVC-SUT
080,Hot Spot Treatment,Services,Dermatology,"Clip, clean, treat hot spot",$45,per visit,,,SVC-HS
081,Allergy Testing,Services,Dermatology,Intradermal or blood allergy panel,$250-350,per panel,,,SVC-ALRG
082,Cytology,Services,Diagnostics,Skin/ear cytology,$40,per sample,,,SVC-CYTO
083,Fluid Therapy (subcutaneous),Services,Treatment,SubQ fluid administration,$45,per treatment,,,SVC-SQF
084,IV Catheter & Fluids,Services,Treatment,IV catheter placement + fluid therapy,$95-150,per treatment,,,SVC-IVF
085,Hospitalization,Services,Inpatient,"Inpatient hospitalization, per day",$85-150,per day,,,SVC-HOSP
086,Euthanasia,Services,End of Life,Humane euthanasia,$85,,,,SVC-EUTH
087,Euthanasia w/ Cremation,Services,End of Life,Euthanasia + private cremation + urn,$250,package,,,SVC-EUTH-CR
088,Paw Print / Clay Impression,Services,Memorial,Clay paw impression keepsake,$25,each,,,SVC-PP
089,Wellness Plan - Adult Dog,Packages,Wellness,"Annual plan: 2 exams, vaccines, HW test, fecal, dental disc.",$45,per month,,,PKG-WP-AD
090,Wellness Plan - Puppy,Packages,Wellness,"Puppy 1st year plan: exams, vaccines, spay/neuter disc",$55,monthly,,,PKG-WP-PUP
091,Wellness Plan - Cat,Packages,,"Annual wellness plan, adult cat",$35,mo,,,PKG-WP-AC
092,Chem 10,Diagnostics,Lab,Basic chemistry 10 panel,$65,,,IDEXX,
093,Thyroid Panel,Diagnostics,Lab,"T4, free T4, TSH",$75,,,IDEXX,SVC-DIAG-THY
094,Pre-Surgical Bloodwork,Services,Pre-Op,Pre-anesthetic blood panel,$95,per panel,,IDEXX,SVC-PREOP
095,Laser Therapy Session,Services,Rehab,"Class IV therapeutic laser, per session",$45,per session,,,SVC-LASER
096,Laser Therapy Pkg (6),Packages,Rehab,6-session laser therapy package,$225,package,,,PKG-LASER6
097,Acupuncture Session,Services,Alternative,Veterinary acupuncture w/ Dr. Chen,$85,per session,,,SVC-ACUP
098,Prescription Medication,Retail,Pharmacy,Various - see specific item,varies,,,,RET-RX
099,Dispensing Fee,Services,Pharmacy,Rx dispensing/filling fee,$12,per Rx,,,SVC-DISP
100,Health Certificate,Services,Documentation,Interstate/international health cert,$50,per cert,,,SVC-HC
101,Boarding + Grooming Combo,Packages,Combo,5+ night stay gets free bath & brush,varies,,,,PKG-BG
102,New Client Package,Packages,Intro,1st exam + basic BW + fecal - $25 off,$120,package,,,PKG-NC
103,Senior Wellness Package,Packages,Wellness,Exam + comp blood + UA + xray,$285,package,,,PKG-SR
104,Trazodone (per tablet),Retail,Pharmacy,"Trazodone 50mg, sedative",$1.50,per tab,,,RET-RX-TRAZ
105,Clavamox Drops,Retail,Pharmacy,Amoxicillin/clavulanate oral suspension,$32,per bottle,,Zoetis,RET-RX-CLAV
106,Apoquel 16mg,Retail,Pharmacy,"Oclacitinib 16mg, 30 tabs",$85,per bottle,,Zoetis,RET-RX-APQ
107,Simparica Trio,Retail,Preventives,Flea/tick/HW combo chewable 6pk,$135.99,6-pack,15,Zoetis,RET-SIM6
108,Cat Tree - Medium,Retail,Furniture,"42"" cat tree with scratching posts",$79.99,each,4,,RET-CT-M
109,Slip Lead,Retail,Supplies,Nylon slip lead 6ft,$8.99,each,20,,RET-SL
110,E-Collar (Cone),Retail,Supplies,"Elizabethan collar, various sizes",$12-18,each,15,,RET-ECON
111,Puppy Socialization Class,Training,Socialization,4-week puppy social hour (8-14 weeks),$80,per course,,,TRN-PS
112,CGC Prep Class,Training,Certification,8-week Canine Good Citizen prep,$220,per course,,,TRN-CGC
113,Overnight Emergency,Services,Emergency,Overnight monitoring & treatment,$350-500,per night,,,SVC-ER-ON

---

### Document 5: 02_standard_operating_procedures.txt (ID: 6, 1601 words)

PAWSITIVE CARE VETERINARY & PET SERVICES
Standard Operating Procedures — INTERNAL USE ONLY
Last updated: Jan 2024 (mostly... some of this is from 2022 still)

=== FRONT DESK / CHECK-IN ===

When a client arrives they need to be checked in thru PawTracker (the main system). If its a new client you need to create their profile first — get all contact info, pet info, how they heard about us, and make sure they fill out the new client form (the green one, not the old yellow ones we dont use anymore). For existing clients just pull them up by last name or phone #. Sometimes the system is slow, just be patient, do NOT restart it during business hours because it messes up the schedule for everyone. If PawTracker goes down completely call Mike in IT, his cell is on the board in the break room.

Check if the pet's vaccines are up to date before ANY service — boarding, grooming, daycare, whatever. The system should flag it but honestly it doesnt always work right especially for the bordetella. If vaccines are expired the pet can NOT go to boarding or daycare, period. Grooming is ok if its just a bath but not if theyre going to be in the group area waiting. Dr. Patel has final say if its a gray area situation.

Payments: we take cash, all major credit cards, and CareCredit. We do NOT do payment plans except through CareCredit. If someone asks for a payment plan, be nice about it but redirect them to CareCredit application — there's a stack of brochures at the front desk. For estimates over $500 we should always present a written estimate and have the client sign. Use the estimate template in PawTracker, print 2 copies.

=== APPOINTMENT SCHEDULING ===

Dr. Patel sees appointments Mon-Fri 8am-5pm and every other Saturday morning. Dr. Kim does Mon/Wed/Fri only plus Tuesday evenings for surgery. Dr. Chen is our specialist — shes only here Thursdays and every other Friday for acupuncture, laser, behavior consults, and complex cases. She does NOT do routine appointments.

Appointment slots are 20 min for routine/recheck, 40 min for new client or sick visit, 60 min for Dr. Chen's behavior consults. Wellness exams can be 20 min for established healthy patients but book 30 if its been over a year since last visit.

URGENT/SAME-DAY: We hold 2 slots per day for urgent cases — one AM one PM. Only the lead tech or doctor can approve a same-day urgent booking. If all urgent slots are full and someone calls with what sounds like a real emergency, tell them to go to Metro Emergency Animal Hospital on 5th Ave. We are NOT a 24-hour facility even though the website used to say we had "emergency services" — we handle urgent stuff during hours only.

Priority scheduling: Tier 2 clients (wellness plan members) get priority for scheduling — they can book up to 2 weeks further out than regular clients and get same-day callbacks from doctors. Gold Paw members (the old loyalty program, not many left) get 10% off retail only, they do NOT get scheduling priority anymore since we switched to the wellness plans.

=== BOARDING PROCEDURES ===

All boarding animals MUST have current vaccines (rabies, DHPP/FVRCP, bordetella for dogs). NO exceptions. Bring up the vacc records in PawTracker before accepting any boarding reservation. Pets also need to be on flea/tick prevention — check with the client and note it in the system.

Feeding: We provide Royal Canin as the default food. If a client brings their own food, label it with the pets name and feeding instructions and put it in the food storage room (the one by the laundry, not the one in the retail area). Medications need to be in original bottles/packaging with clear instructions — have the client fill out a med admin form.

Dogs get 3 outdoor breaks minimum per day — 7am, 12pm, 5pm. Deluxe suite dogs get an extra play session and a webcam check-in that we email to the owner every evening. Use the iPad in the boarding area to take the photo and upload it through PawTracker.

Cleaning protocol: All kennels cleaned and disinfected with Rescue (the purple cleaner) every morning and spot-cleaned throughout the day. Deep clean with the steam machine on Wednesdays and Sundays or whenever a kennel is vacated between guests.

Cat boarding is separate from dogs — cats are in the cat wing. NEVER walk a dog through the cat boarding area. This sounds obvious but it happened twice last year and Mrs. Patterson still brings it up.

For exotic/small animal boarding, only Lisa or Dr. Patel are qualified to handle. Check with them before booking exotic boarding.

=== GROOMING ===

All grooming dogs go through an initial assessment by the groomer — check for fleas, ticks, skin issues, mats, etc. If something medical is found, the groomer should alert the front desk and we'll try to get a tech or doctor to take a look. NEVER have the groomer try to treat a medical issue — they can note it but that's it.

Grooming uses a separate schedule in PawTracker (its under the "Spa" tab, not the main calendar). Jess is our lead groomer Mon-Sat, and we have part-time groomers Tues/Thurs/Sat. Grooming appointments are generally drop-off in the morning pick-up in the afternoon, but we do accommodate specific time requests for an extra $10 "priority scheduling fee" — don't confuse this with the rush fee for same-day grooming which is $15.

Cats: We require cats to be sedated for full grooming unless the owner signs a waiver AND the cat has been here before without incident. Cat sedation requires a tech and costs extra — its billed as a "minor procedure" not a grooming add-on. Trazodone pre-medication is the preferred protocol, client gives it at home 2 hrs before appt.

=== INVENTORY & RETAIL ===

Retail inventory is tracked in PawTracker under the Inventory module. Rx items (prescription food, medications) are tracked separately in the pharmacy log AND PawTracker — yes its redundant but the pharmacy board requires the separate log.

Reordering: Most retail items auto-reorder through our distributor (MWI/Patterson) when they hit the minimum threshold in the system. But someone (usually Amanda or whoever is on inventory duty that week) needs to check the pending orders report every Monday and approve them. Prescription diet orders go through a different portal (Royal Canin Direct and Hill's to Home) — those are NOT on auto-reorder.

Returns: We accept returns on unopened retail items within 30 days with receipt. No returns on prescription items or medications per state law. Opened food bags cannot be returned but we will do an exchange if the pet didn't like it — one exchange per customer, per product. Mark the return/exchange in PawTracker AND write it in the return log binder at the front desk.

=== TRAINING ===

Group classes run in 6-week cycles (8 weeks for CGC prep). Classes are in the training room which is the big room behind the retail area — NOT the exam rooms. Max class size is 6 dogs for puppy/basic, 4 for CGC.

Sarah runs all group classes and does most private sessions. Dr. Chen handles behavior consultations which are different from training — behavior is a medical/veterinary assessment, training is skill-building. If someone calls asking for help with aggression, resource guarding, or severe anxiety, that should be booked as a behavior consult with Dr. Chen, not a training session with Sarah.

Board & Train: Dogs stay in boarding while enrolled in training. They get 2 training sessions per day (AM & PM) plus all standard boarding amenities. The 2-week program covers basic obedience, the 4-week is for more complex issues or advanced work. Board & train dogs are NOT mixed with regular boarding dogs during training sessions but they DO share the outdoor areas during regular break times.

=== MEDICAL RECORDS & LAB WORK ===

All patient records are in PawTracker. Lab work gets sent to IDEXX (reference lab) for most panels — results come back electronically and auto-attach to the patient file. In-house we can run snap tests (heartworm, FeLV/FIV, parvo), basic CBC on the ProCyte, and urinalysis. The ProCyte machine is finicky — if it gives an error, run the cleaning cycle first before calling IDEXX support.

Controlled substances log: Dr. Patel or Dr. Kim must sign out any controlled substance. Its in the red binder in the locked cabinet in treatment. Techs can PULL controlled substances but a doctor must authorize and sign. This is a DEA requirement, no exceptions, dont let anyone tell you otherwise.

Prescription refills: For maintenance meds (heartworm prevention, flea/tick, chronic meds), the front desk can process a refill if theres an active Rx on file and the annual exam is current. If the exam is overdue, the client needs to schedule before we can refill. This is state vet board policy. Exception: we give a one-time 30-day courtesy refill for chronic meds (like thyroid, heart meds) if the client has an appointment scheduled within 30 days.

=== CLOSING PROCEDURES ===

End of day: Run the end-of-day report in PawTracker. Balance the register — cash + credit should match the report within $5. If its more than $5 off, note it on the discrepancy log and tell Amanda in the morning. Lock all controlled substance cabinets. Check boarding — all animals fed, watered, comfortable. Set the alarm (code is posted inside the manager's office closet, please dont share it). Last person out locks the back door AND front door.

---

## Existing Terms (for deduplication)

(none — this is a fresh project)

When extracting terms, avoid duplicating any of these existing concepts. If you find a concept that matches an existing term, skip it — it will be resolved during the merge stage.

---

## Step 2 — CHUNK (stage: chunk)

Split the document text into semantic chunks of roughly 300-500 words each. Split on paragraph boundaries.
This is a simple text operation — no AI reasoning needed.

**Update progress:**

```bash
curl -s -X PATCH http://localhost:3004/api/ontologica/jobs/10/agent-update \
  -H "Content-Type: application/json" \
  -d '{"pipeline_stage":"chunk","progress_pct":8,"current_step":"Chunking documents..."}'
```

After chunking, log the result:

```bash
curl -s -X POST http://localhost:3004/api/ontologica/jobs/10/log \
  -H "Content-Type: application/json" \
  -d '{"stage":"chunk","level":"success","title":"Created N chunks","detail":"Average ~M words per chunk"}'
```

Update document chunk counts:

```bash
curl -s -X PATCH http://localhost:3004/api/ontologica/documents/9/chunk-count \
  -H "Content-Type: application/json" \
  -d '{"chunk_count":N,"status":"processed"}'
```

```bash
curl -s -X PATCH http://localhost:3004/api/ontologica/documents/7/chunk-count \
  -H "Content-Type: application/json" \
  -d '{"chunk_count":N,"status":"processed"}'
```

```bash
curl -s -X PATCH http://localhost:3004/api/ontologica/documents/8/chunk-count \
  -H "Content-Type: application/json" \
  -d '{"chunk_count":N,"status":"processed"}'
```

```bash
curl -s -X PATCH http://localhost:3004/api/ontologica/documents/10/chunk-count \
  -H "Content-Type: application/json" \
  -d '{"chunk_count":N,"status":"processed"}'
```

```bash
curl -s -X PATCH http://localhost:3004/api/ontologica/documents/6/chunk-count \
  -H "Content-Type: application/json" \
  -d '{"chunk_count":N,"status":"processed"}'
```

Mark stage complete:

```bash
curl -s -X PATCH http://localhost:3004/api/ontologica/jobs/10/agent-update \
  -H "Content-Type: application/json" \
  -d '{"stages_complete_add":"chunk"}'
```

---

## Step 3 — EXTRACT TERMS (stage: terms)

For each chunk, identify ALL meaningful domain concepts, entities, and terms.

**Domain context:** veterinary, healthcare, retail, hospitality, pet services

**Guidelines:**

- Extract concrete, meaningful terms — not generic words like "system" or "process" unless domain-specific
- Prefer noun phrases over single words when they carry more meaning
- Classify as **CLASS** if it represents a category (e.g., "Customer", "Invoice", "Product Type")
- Classify as **INDIVIDUAL** if it's a specific named instance (e.g., "Acme Corp", "Invoice #1234")
- Assign confidence 0.0-1.0 based on how clearly the text supports this term being a domain concept
- Do NOT fabricate terms not present or clearly implied by the text
- Skip any terms that match the existing terms list above

**Update progress per chunk:**

```bash
curl -s -X PATCH http://localhost:3004/api/ontologica/jobs/10/agent-update \
  -H "Content-Type: application/json" \
  -d '{"pipeline_stage":"terms","progress_pct":PERCENT,"current_step":"Extracting terms from chunk X/N..."}'
```

(Progress should go from 10% to 25% across all chunks)

**Log per chunk:**

```bash
curl -s -X POST http://localhost:3004/api/ontologica/jobs/10/log \
  -H "Content-Type: application/json" \
  -d '{"stage":"terms","level":"success","title":"Chunk X: found N terms","detail":"term1, term2, term3..."}'
```

After all chunks, log the total:

```bash
curl -s -X POST http://localhost:3004/api/ontologica/jobs/10/log \
  -H "Content-Type: application/json" \
  -d '{"stage":"terms","level":"milestone","title":"Extracted N raw terms","detail":"X classes, Y individuals"}'
```

Mark stage: `{"stages_complete_add":"terms"}`

---

## Step 4 — CLASSIFY & REFINE (stage: classify)

Review ALL extracted terms together. With full context:

- Merge duplicates (e.g., "Customer" and "Customers" → keep "Customer" as class)
- Reclassify any mistyped terms (individuals that should be classes, or vice versa)
- Adjust confidence scores based on broader context
- Remove terms that don't truly belong to the domain "veterinary, healthcare, retail, hospitality, pet services"

Update progress to 30-35%.

Log: `{"stage":"classify","level":"success","title":"Refined to N terms","detail":"Merged M duplicates, reclassified K"}`

Mark stage: `{"stages_complete_add":"classify"}`

---

## Step 5 — BUILD TAXONOMY (stage: taxonomy)

From the refined class terms, build an IS-A hierarchy.

**Guidelines:**

- Only create IS-A (subclass) relationships that are semantically correct
- Build proper depth — avoid flat structures. Think about intermediate classes.
- Not every class needs a parent — top-level domain concepts are root classes
- Avoid circular hierarchies (A → B → A)
- Assign confidence per relationship

Update progress to 45-50%.

Log: `{"stage":"taxonomy","level":"success","title":"Built N IS-A relationships","detail":"M root classes"}`

Mark stage: `{"stages_complete_add":"taxonomy"}`

---

## Step 6 — EXTRACT RELATIONS (stage: relations)

Extract non-taxonomic relationships between terms.

**Relationship types:**

- **object_property**: links two entities (e.g., Customer PLACES Order, Product BELONGS_TO Category)
- **data_property**: an entity has a data attribute (e.g., Customer HAS_NAME string, Order HAS_DATE date)

**Guidelines:**

- Only extract relationships clearly supported by the document text
- Name relationships with clear, verb-based names (hasCustomer, placedBy, belongsTo)
- For data_property, the target is a data type description, not another entity
- Assign confidence per relationship

Update progress to 60-70%.

Log: `{"stage":"relations","level":"success","title":"Found N relationships","detail":"X object properties, Y data properties"}`

Mark stage: `{"stages_complete_add":"relations"}`

---

## Step 7 — VALIDATE (stage: validate)

Run a metacognitive quality check (inspired by the Ontogenia method):

1. **INTERPRETATION** — Do the concepts accurately represent the domain "veterinary, healthcare, retail, hospitality, pet services"?
2. **REFLECTION** — Are there obvious gaps? Missing intermediate classes? Missing key relationships?
3. **EVALUATION** — Check for: circular hierarchies, duplicate concepts, orphaned individuals, overly shallow hierarchy, hallucinated references
4. **TESTING** — Would domain experts accept this ontology? What would they challenge?

For each issue found, classify as:

- `hallucinated_ref` — concept doesn't belong in this domain
- `bad_domain_range` — relationship connects wrong types
- `shallow_hierarchy` — missing intermediate classes
- `duplicate` — two terms mean the same thing
- `circular` — circular IS-A chain

**Apply fixes:**

- Remove hallucinated terms
- Add missing intermediate classes
- Fix relation domain/range errors
- Merge remaining duplicates

Update progress to 75-80%.

Log issues and fixes:

```bash
curl -s -X POST http://localhost:3004/api/ontologica/jobs/10/log \
  -H "Content-Type: application/json" \
  -d '{"stage":"validate","level":"warn","title":"Found N validation issues","detail":"[error] Entity: description\n[warning] Entity: description"}'
```

Mark stage: `{"stages_complete_add":"validate"}`

---

## Step 8 — MERGE INTO GRAPH (stage: merge)

Now write the final extracted ontology to the database. This is the critical step.

**IMPORTANT: Track node IDs.** When you create a node, the response includes its `id`. You MUST capture these IDs to create edges (which reference source/target node IDs).

### 8a. Create nodes

For each term (classes first, then individuals):

```bash
curl -s -X POST http://localhost:3004/api/ontologica/projects/1/nodes \
  -H "Content-Type: application/json" \
  -d '{
    "node_type": "class",
    "name": "TermName",
    "description": "What this concept means",
    "confidence": 0.9,
    "status": "suggested",
    "extraction_job_id": 10,
    "pos_x": 0,
    "pos_y": 0
  }'
```

**Layout:** Arrange nodes in a grid. Classes at top, individuals below.

- `pos_x`: (index % 4) \* 250
- `pos_y`: floor(index / 4) \* 180 (offset individuals below classes)

**Capture the `id` from each response** and maintain a mapping: term_name → node_id.

**Deduplication:** Before creating a node, the API checks for existing nodes with the same name (case-insensitive). If a node already exists, note its ID from the existing terms but don't re-create it.

### 8b. Create taxonomy edges

For each IS-A relationship:

```bash
curl -s -X POST http://localhost:3004/api/ontologica/projects/1/edges \
  -H "Content-Type: application/json" \
  -d '{
    "edge_type": "is_a",
    "name": "subClassOf",
    "source_node_id": CHILD_NODE_ID,
    "target_node_id": PARENT_NODE_ID,
    "description": "ChildName IS-A ParentName",
    "confidence": 0.9,
    "extraction_job_id": 10
  }'
```

Also set the parent on the child node:

```bash
curl -s -X PUT http://localhost:3004/api/ontologica/projects/1/nodes/CHILD_NODE_ID \
  -H "Content-Type: application/json" \
  -d '{"parent_id": PARENT_NODE_ID}'
```

### 8c. Create relation edges

For object properties:

```bash
curl -s -X POST http://localhost:3004/api/ontologica/projects/1/edges \
  -H "Content-Type: application/json" \
  -d '{
    "edge_type": "object_property",
    "name": "relationName",
    "source_node_id": SOURCE_ID,
    "target_node_id": TARGET_ID,
    "description": "Source relationName Target",
    "confidence": 0.8,
    "extraction_job_id": 10
  }'
```

For data properties:

```bash
curl -s -X POST http://localhost:3004/api/ontologica/projects/1/edges \
  -H "Content-Type: application/json" \
  -d '{
    "edge_type": "data_property",
    "name": "propertyName",
    "source_node_id": SOURCE_ID,
    "target_value": "string description of the data type",
    "description": "Source has propertyName",
    "confidence": 0.8,
    "extraction_job_id": 10
  }'
```

Update progress to 90-95% during merge.

Log: `{"stage":"merge","level":"success","title":"Created N nodes and M edges","detail":"K terms matched existing nodes (dedup)"}`

Mark stage: `{"stages_complete_add":"merge"}`

---

## Step 9 — Complete

```bash
curl -s -X POST http://localhost:3004/api/ontologica/jobs/10/complete \
  -H "Content-Type: application/json" \
  -d '{"nodes_created": N, "edges_created": M}'
```

This marks the job as completed and updates project counts.

---

## On Failure

If anything goes wrong at any stage, report the failure:

```bash
curl -s -X PATCH http://localhost:3004/api/ontologica/jobs/10/agent-update \
  -H "Content-Type: application/json" \
  -d '{"status":"failed","error":"DESCRIPTION OF WHAT WENT WRONG"}'
```

```bash
curl -s -X POST http://localhost:3004/api/ontologica/jobs/10/log \
  -H "Content-Type: application/json" \
  -d '{"stage":"pipeline","level":"error","title":"Pipeline failed","detail":"DESCRIPTION"}'
```

---

## Quality Standards

- **Be thorough.** Read every document carefully. Don't skip content.
- **Be precise.** Only extract concepts that are genuinely present in the text.
- **Be structured.** Follow the exact JSON formats for API calls.
- **Be transparent.** Log your reasoning at each stage so Diego can review.
- **Confidence matters.** High confidence (0.8+) for clearly stated concepts. Lower (0.5-0.7) for implied ones.
- **Dedup aggressively.** Better to merge two similar concepts than to have near-duplicates in the graph.
