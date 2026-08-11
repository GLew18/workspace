// Cobalt: the daily-quote library (Dashboard ▸ Daily quote).
//
// Five styles, selected in Settings ▸ Profile ▸ Quote style (prefs.dash.quoteStyle):
// Stoic, Modern, Literary, Science & discovery, and Mixed (a blend of all four).
// Every list is interleaved round-robin by author so consecutive days rotate
// through different voices instead of marching through one author's block.
// The pick is deterministic: one quote per calendar day.

export interface Quote {
  text: string;
  author: string;
}

export type QuoteStyle = 'stoic' | 'modern' | 'literary' | 'science' | 'mixed';

// ===================== STOIC =====================
const STOIC: Quote[] = [
  // ===== EPICTETUS =====
  { text: "It is not what happens to you, but how you react to it that matters.", author: "Epictetus" },
  { text: "First say to yourself what you would be; and then do what you have to do.", author: "Epictetus" },
  { text: "No man is free who is not master of himself.", author: "Epictetus" },
  { text: "Difficulty shows what men are.", author: "Epictetus" },
  { text: "Make the best use of what is in your power, and take the rest as it happens.", author: "Epictetus" },
  { text: "Circumstances don't make the man, they only reveal him to himself.", author: "Epictetus" },
  { text: "Any person capable of angering you becomes your master.", author: "Epictetus" },
  { text: "We cannot choose our external circumstances, but we can always choose how we respond to them.", author: "Epictetus" },
  { text: "The trials we endure can and should introduce us to our strengths.", author: "Epictetus" },
  { text: "If you want to improve, be content to be thought foolish and stupid.", author: "Epictetus" },
  { text: "Wealth consists not in having great possessions, but in having few wants.", author: "Epictetus" },
  { text: "Freedom is the only worthy goal in life. It is won by disregarding things that lie beyond our control.", author: "Epictetus" },
  { text: "He who laughs at himself never runs out of things to laugh at.", author: "Epictetus" },
  { text: "Other people's troubles can be contagious. Don't sabotage yourself by adopting their negativity.", author: "Epictetus" },
  { text: "Only the educated are free.", author: "Epictetus" },
  { text: "First learn the meaning of what you say, and then speak.", author: "Epictetus" },
  { text: "The two most powerful warriors are patience and time.", author: "Epictetus" },
  { text: "The key is to keep company only with people who uplift you, whose presence calls forth your best.", author: "Epictetus" },
  { text: "Don't just say you have read books. Show that through them you have learned to think better.", author: "Epictetus" },
  { text: "Curb your desire: don't set your heart on so many things and you will get what you need.", author: "Epictetus" },
  { text: "He who is not satisfied with little is satisfied with nothing.", author: "Epictetus" },
  { text: "If your choices are beautiful, so too will you be.", author: "Epictetus" },
  { text: "It is impossible for a man to learn what he thinks he already knows.", author: "Epictetus" },
  { text: "Don't be afraid of what you'll lose. Be afraid of what you'll never have.", author: "Epictetus" },

  // ===== MARCUS AURELIUS =====
  { text: "The impediment to action advances action. What stands in the way becomes the way.", author: "Marcus Aurelius" },
  { text: "You have power over your mind, not outside events. Realize this, and you will find strength.", author: "Marcus Aurelius" },
  { text: "Reject your sense of injury and the injury itself disappears.", author: "Marcus Aurelius" },
  { text: "Waste no more time arguing what a good man should be. Be one.", author: "Marcus Aurelius" },
  { text: "The best revenge is to be unlike him who performed the injury.", author: "Marcus Aurelius" },
  { text: "Confine yourself to the present.", author: "Marcus Aurelius" },
  { text: "Everything we hear is an opinion, not a fact. Everything we see is a perspective, not the truth.", author: "Marcus Aurelius" },
  { text: "When you arise in the morning, think of what a precious privilege it is to be alive: to breathe, to think, to enjoy, to love.", author: "Marcus Aurelius" },
  { text: "Dwell on the beauty of life. Watch the stars, and see yourself running with them.", author: "Marcus Aurelius" },
  { text: "If it is not right, do not do it; if it is not true, do not say it.", author: "Marcus Aurelius" },
  { text: "The happiness of your life depends upon the quality of your thoughts.", author: "Marcus Aurelius" },
  { text: "It is not death that a man should fear, but he should fear never beginning to live.", author: "Marcus Aurelius" },
  { text: "Do every act of your life as though it were the very last act of your life.", author: "Marcus Aurelius" },
  { text: "Death smiles at us all, but all a man can do is smile back.", author: "Marcus Aurelius" },
  { text: "The soul becomes dyed with the color of its thoughts.", author: "Marcus Aurelius" },
  { text: "Anywhere you can lead your life, you can lead a good one.", author: "Marcus Aurelius" },
  { text: "Be tolerant with others and strict with yourself.", author: "Marcus Aurelius" },
  { text: "Choose not to be harmed, and you won't feel harmed. Don't feel harmed, and you haven't been.", author: "Marcus Aurelius" },
  { text: "External things are not the problem. It's your assessment of them. Which you can erase right now.", author: "Marcus Aurelius" },
  { text: "It is in your power to withdraw yourself whenever you desire.", author: "Marcus Aurelius" },
  { text: "The universe is change; our life is what our thoughts make it.", author: "Marcus Aurelius" },
  { text: "Be like the cliff against which the waves continually break; it stands firm and tames the fury of the water around it.", author: "Marcus Aurelius" },
  { text: "He who lives in harmony with himself lives in harmony with the universe.", author: "Marcus Aurelius" },
  { text: "Do not act as if you had ten thousand years to throw away. Be good for something while you live and it is in your power.", author: "Marcus Aurelius" },
  { text: "A man's worth is no greater than the worth of his ambitions.", author: "Marcus Aurelius" },
  { text: "Begin. To begin is half the work.", author: "Marcus Aurelius" },
  { text: "The art of living is more like wrestling than dancing.", author: "Marcus Aurelius" },
  { text: "The mind is everything; what you think, you become.", author: "Marcus Aurelius" },
  { text: "Stop drifting. Start living.", author: "Marcus Aurelius" },
  { text: "Do not waste the remainder of your life thinking about other people.", author: "Marcus Aurelius" },
  { text: "Each of us lives only now, this brief instant.", author: "Marcus Aurelius" },
  { text: "Death? Necessary. Fear of it? Foolish.", author: "Marcus Aurelius" },
  { text: "Nowhere can man find a quieter or more untroubled retreat than in his own soul.", author: "Marcus Aurelius" },
  { text: "Bear in mind that the measure of a man is the worth of the things he cares about.", author: "Marcus Aurelius" },
  { text: "Be content to seem what you really are.", author: "Marcus Aurelius" },

  // ===== SENECA =====
  { text: "Difficulties strengthen the mind, as labor does the body.", author: "Seneca" },
  { text: "A gem cannot be polished without friction, nor a man perfected without trials.", author: "Seneca" },
  { text: "We suffer more often in imagination than in reality.", author: "Seneca" },
  { text: "Sometimes even to live is an act of courage.", author: "Seneca" },
  { text: "No man is more unhappy than he who never faces adversity. For he is not permitted to prove himself.", author: "Seneca" },
  { text: "He suffers more than necessary, who suffers before it is necessary.", author: "Seneca" },
  { text: "The man who has anticipated the coming of troubles takes away their power when they arrive.", author: "Seneca" },
  { text: "Luck is what happens when preparation meets opportunity.", author: "Seneca" },
  { text: "It is not the man who has too little, but the man who craves more, that is poor.", author: "Seneca" },
  { text: "Most powerful is he who has himself in his own power.", author: "Seneca" },
  { text: "Begin at once to live, and count each separate day as a separate life.", author: "Seneca" },
  { text: "There is no easy way from the earth to the stars.", author: "Seneca" },
  { text: "Fire tests gold; misfortune, brave men.", author: "Seneca" },
  { text: "It is the power of the mind to be unconquerable.", author: "Seneca" },
  { text: "The whole future lies in uncertainty: live immediately.", author: "Seneca" },
  { text: "Life, if well lived, is long enough.", author: "Seneca" },
  { text: "While we are postponing, life speeds by.", author: "Seneca" },
  { text: "All cruelty springs from weakness.", author: "Seneca" },
  { text: "If you really want to escape the things that harass you, what you're needing is not to be in a different place but to be a different person.", author: "Seneca" },
  { text: "As long as you live, keep learning how to live.", author: "Seneca" },
  { text: "If a man knows not to which port he sails, no wind is favorable.", author: "Seneca" },
  { text: "True happiness is to enjoy the present, without anxious dependence upon the future.", author: "Seneca" },
  { text: "He who fears death will never do anything worthy of a man who is alive.", author: "Seneca" },
  { text: "It is the mark of a great man that he treats trifles as trifles and important matters as important.", author: "Seneca" },
  { text: "Cease to hope and you will cease to fear.", author: "Seneca" },
  { text: "The bravest sight in the world is to see a great man struggling against adversity.", author: "Seneca" },
  { text: "To bear trials with a calm mind robs misfortune of its strength and burden.", author: "Seneca" },
  { text: "He who is brave is free.", author: "Seneca" },
  { text: "The greatest remedy for anger is delay.", author: "Seneca" },
  { text: "Calamity is virtue's opportunity.", author: "Seneca" },
  { text: "The mind that is anxious about future events is miserable.", author: "Seneca" },
  { text: "No man was ever wise by chance.", author: "Seneca" },
  { text: "Throw me to the wolves and I will return leading the pack.", author: "Seneca" },
  { text: "Every new beginning comes from some other beginning's end.", author: "Seneca" },
  { text: "It is not because things are difficult that we do not dare; it is because we do not dare that they are difficult.", author: "Seneca" },
  { text: "Things that were hard to bear are sweet to remember.", author: "Seneca" },
  { text: "The greatest blessings of mankind are within us and within our reach. A wise man is content with his lot.", author: "Seneca" },
  { text: "The greatest obstacle to living is expectancy, which hangs upon tomorrow and loses today.", author: "Seneca" },
  { text: "As is a tale, so is life: not how long it is, but how good it is, is what matters.", author: "Seneca" },
  { text: "Wherever there is a human being, there is an opportunity for kindness.", author: "Seneca" },
  { text: "Until we have begun to go without them, we fail to realize how unnecessary many things are.", author: "Seneca" },
  { text: "Where fear is, happiness is not.", author: "Seneca" },
  { text: "Wealth is the slave of a wise man and the master of a fool.", author: "Seneca" },
  { text: "He has the power to die who has the courage to live.", author: "Seneca" },
  { text: "What is harder than rock? What is softer than water? Yet soft water hollows out hard rock. Persevere.", author: "Seneca" },
  { text: "It is not that we have a short time to live, but that we waste a lot of it.", author: "Seneca" },

  // ===== ZENO OF CITIUM =====
  { text: "Man conquers the world by conquering himself.", author: "Zeno of Citium" },
  { text: "Well-being is realized by small steps, but is truly no small thing.", author: "Zeno of Citium" },
  { text: "Happiness is a good flow of life.", author: "Zeno of Citium" },
  { text: "The goal of life is living in agreement with nature.", author: "Zeno of Citium" },
  { text: "We have two ears and one mouth, so we should listen more than we say.", author: "Zeno of Citium" },
  { text: "Better to trip with the feet than with the tongue.", author: "Zeno of Citium" },
  { text: "All the good are friends of one another.", author: "Zeno of Citium" },

  // ===== CLEANTHES =====
  { text: "The willing are led by fate, the reluctant are dragged.", author: "Cleanthes" },
  { text: "Nothing is sweeter than virtue, nothing surer than understanding.", author: "Cleanthes" },

  // ===== HERACLITUS =====
  { text: "Character is destiny.", author: "Heraclitus" },
  { text: "No man ever steps in the same river twice, for it's not the same river and he's not the same man.", author: "Heraclitus" },
  { text: "Big results require big ambitions.", author: "Heraclitus" },
  { text: "Much learning does not teach understanding.", author: "Heraclitus" },
  { text: "Day by day, what you choose, what you think and what you do is who you become.", author: "Heraclitus" },
  { text: "It is in changing that things find purpose.", author: "Heraclitus" },

  // ===== MUSONIUS RUFUS =====
  { text: "To complain about anything is to blame nature.", author: "Musonius Rufus" },
  { text: "We must drink that which is bitter for the sake of health.", author: "Musonius Rufus" },
  { text: "What is noble is learned only with difficulty, and only by trial.", author: "Musonius Rufus" },
  { text: "If you accomplish something good with hard work, the labor passes quickly, but the good endures.", author: "Musonius Rufus" },
  { text: "The Stoic pursues virtue not for what it brings, but for what it is.", author: "Musonius Rufus" },

  // ===== CATO THE YOUNGER =====
  { text: "I begin to speak only when I am certain what I will say is not better left unsaid.", author: "Cato the Younger" },
  { text: "Hold on, my heart, to what is right, that I may sleep without remorse.", author: "Cato the Younger" },
];

// ===================== MODERN =====================
// Builders, athletes, artists, and leaders of the last ~120 years.
const MODERN: Quote[] = [
  // ===== WALT DISNEY =====
  { text: "The way to get started is to quit talking and begin doing.", author: "Walt Disney" },
  { text: "All our dreams can come true, if we have the courage to pursue them.", author: "Walt Disney" },
  { text: "It's kind of fun to do the impossible.", author: "Walt Disney" },
  { text: "The difference between winning and losing is most often not quitting.", author: "Walt Disney" },
  { text: "When you believe in a thing, believe in it all the way, implicitly and unquestionably.", author: "Walt Disney" },
  { text: "Times and conditions change so rapidly that we must keep our aim constantly focused on the future.", author: "Walt Disney" },
  { text: "If you can dream it, you can do it.", author: "Walt Disney" },

  // ===== STEVE JOBS =====
  { text: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
  { text: "Your time is limited, so don't waste it living someone else's life.", author: "Steve Jobs" },
  { text: "Stay hungry, stay foolish.", author: "Steve Jobs" },
  { text: "Innovation distinguishes between a leader and a follower.", author: "Steve Jobs" },
  { text: "Have the courage to follow your heart and intuition. They somehow already know what you truly want to become.", author: "Steve Jobs" },
  { text: "Quality is more important than quantity. One home run is much better than two doubles.", author: "Steve Jobs" },
  { text: "You can't connect the dots looking forward; you can only connect them looking backwards.", author: "Steve Jobs" },
  { text: "Details matter. It's worth waiting to get it right.", author: "Steve Jobs" },
  { text: "The people who are crazy enough to think they can change the world are the ones who do.", author: "Steve Jobs" },

  // ===== MAYA ANGELOU =====
  { text: "Nothing will work unless you do.", author: "Maya Angelou" },
  { text: "You may encounter many defeats, but you must not be defeated.", author: "Maya Angelou" },
  { text: "If you don't like something, change it. If you can't change it, change your attitude.", author: "Maya Angelou" },
  { text: "We may encounter many defeats but we must not be defeated.", author: "Maya Angelou" },
  { text: "Try to be a rainbow in someone's cloud.", author: "Maya Angelou" },
  { text: "You can't use up creativity. The more you use, the more you have.", author: "Maya Angelou" },
  { text: "Do the best you can until you know better. Then when you know better, do better.", author: "Maya Angelou" },
  { text: "All great achievements require time.", author: "Maya Angelou" },
  { text: "Success is liking yourself, liking what you do, and liking how you do it.", author: "Maya Angelou" },

  // ===== MUHAMMAD ALI =====
  { text: "Don't count the days; make the days count.", author: "Muhammad Ali" },
  { text: "He who is not courageous enough to take risks will accomplish nothing in life.", author: "Muhammad Ali" },
  { text: "I hated every minute of training, but I said, don't quit. Suffer now and live the rest of your life as a champion.", author: "Muhammad Ali" },
  { text: "Impossible is not a fact. It's an opinion.", author: "Muhammad Ali" },
  { text: "It isn't the mountains ahead to climb that wear you out; it's the pebble in your shoe.", author: "Muhammad Ali" },
  { text: "Service to others is the rent you pay for your room here on earth.", author: "Muhammad Ali" },
  { text: "The man who has no imagination has no wings.", author: "Muhammad Ali" },
  { text: "A man who views the world the same at fifty as he did at twenty has wasted thirty years of his life.", author: "Muhammad Ali" },

  // ===== MICHAEL JORDAN =====
  { text: "I've failed over and over and over again in my life. And that is why I succeed.", author: "Michael Jordan" },
  { text: "Talent wins games, but teamwork and intelligence win championships.", author: "Michael Jordan" },
  { text: "I've missed more than 9000 shots in my career. I've lost almost 300 games. Twenty-six times I've been trusted to take the game-winning shot and missed.", author: "Michael Jordan" },
  { text: "Obstacles don't have to stop you. If you run into a wall, don't turn around and give up. Figure out how to climb it.", author: "Michael Jordan" },
  { text: "Some people want it to happen, some wish it would happen, others make it happen.", author: "Michael Jordan" },
  { text: "Never say never, because limits, like fears, are often just an illusion.", author: "Michael Jordan" },
  { text: "You must expect great things of yourself before you can do them.", author: "Michael Jordan" },
  { text: "Get the fundamentals down and the level of everything you do will rise.", author: "Michael Jordan" },

  // ===== KOBE BRYANT =====
  { text: "The moment you give up is the moment you let someone else win.", author: "Kobe Bryant" },
  { text: "Everything negative, pressure, challenges, is all an opportunity for me to rise.", author: "Kobe Bryant" },
  { text: "Great things come from hard work and perseverance. No excuses.", author: "Kobe Bryant" },
  { text: "I have self-doubt. I have insecurity. I have fear of failure. We all have self-doubt. You don't deny it, but you also don't capitulate to it.", author: "Kobe Bryant" },
  { text: "Once you know what failure feels like, determination chases success.", author: "Kobe Bryant" },
  { text: "If you're afraid to fail, then you're probably going to fail.", author: "Kobe Bryant" },

  // ===== SERENA WILLIAMS =====
  { text: "A champion is defined not by their wins but by how they can recover when they fall.", author: "Serena Williams" },
  { text: "I really think a champion is defined not by their wins, but by how they can recover when they fall.", author: "Serena Williams" },
  { text: "Every point that I play is in that moment. Every point matters.", author: "Serena Williams" },
  { text: "Luck has nothing to do with it, because I have spent many, many hours on my craft.", author: "Serena Williams" },
  { text: "You have to believe in yourself when no one else does.", author: "Serena Williams" },

  // ===== ELEANOR ROOSEVELT =====
  { text: "The future belongs to those who believe in the beauty of their dreams.", author: "Eleanor Roosevelt" },
  { text: "You gain strength, courage, and confidence by every experience in which you really stop to look fear in the face.", author: "Eleanor Roosevelt" },
  { text: "Do one thing every day that scares you.", author: "Eleanor Roosevelt" },
  { text: "No one can make you feel inferior without your consent.", author: "Eleanor Roosevelt" },
  { text: "It is better to light a candle than curse the darkness.", author: "Eleanor Roosevelt" },
  { text: "With the new day comes new strength and new thoughts.", author: "Eleanor Roosevelt" },
  { text: "Great minds discuss ideas; average minds discuss events; small minds discuss people.", author: "Eleanor Roosevelt" },
  { text: "The purpose of life is to live it, to taste experience to the utmost, to reach out eagerly and without fear for newer and richer experience.", author: "Eleanor Roosevelt" },

  // ===== WINSTON CHURCHILL =====
  { text: "Success is not final, failure is not fatal: it is the courage to continue that counts.", author: "Winston Churchill" },
  { text: "Never, never, never give up.", author: "Winston Churchill" },
  { text: "Attitude is a little thing that makes a big difference.", author: "Winston Churchill" },
  { text: "Continuous effort, not strength or intelligence, is the key to unlocking our potential.", author: "Winston Churchill" },
  { text: "A pessimist sees the difficulty in every opportunity; an optimist sees the opportunity in every difficulty.", author: "Winston Churchill" },
  { text: "If you're going through hell, keep going.", author: "Winston Churchill" },
  { text: "Courage is what it takes to stand up and speak; courage is also what it takes to sit down and listen.", author: "Winston Churchill" },
  { text: "We make a living by what we get, but we make a life by what we give.", author: "Winston Churchill" },
  { text: "Kites rise highest against the wind, not with it.", author: "Winston Churchill" },
  { text: "The price of greatness is responsibility.", author: "Winston Churchill" },

  // ===== NELSON MANDELA =====
  { text: "It always seems impossible until it's done.", author: "Nelson Mandela" },
  { text: "Education is the most powerful weapon which you can use to change the world.", author: "Nelson Mandela" },
  { text: "The greatest glory in living lies not in never falling, but in rising every time we fall.", author: "Nelson Mandela" },
  { text: "I never lose. I either win or learn.", author: "Nelson Mandela" },
  { text: "Do not judge me by my successes, judge me by how many times I fell down and got back up again.", author: "Nelson Mandela" },
  { text: "May your choices reflect your hopes, not your fears.", author: "Nelson Mandela" },
  { text: "Courage is not the absence of fear, but the triumph over it.", author: "Nelson Mandela" },
  { text: "A winner is a dreamer who never gives up.", author: "Nelson Mandela" },

  // ===== MARTIN LUTHER KING JR. =====
  { text: "If you can't fly then run, if you can't run then walk, if you can't walk then crawl, but whatever you do you have to keep moving forward.", author: "Martin Luther King Jr." },
  { text: "The time is always right to do what is right.", author: "Martin Luther King Jr." },
  { text: "Faith is taking the first step even when you don't see the whole staircase.", author: "Martin Luther King Jr." },
  { text: "Darkness cannot drive out darkness; only light can do that.", author: "Martin Luther King Jr." },
  { text: "Life's most persistent and urgent question is, 'What are you doing for others?'", author: "Martin Luther King Jr." },
  { text: "We must accept finite disappointment, but never lose infinite hope.", author: "Martin Luther King Jr." },
  { text: "The ultimate measure of a man is not where he stands in moments of comfort, but where he stands at times of challenge.", author: "Martin Luther King Jr." },
  { text: "Intelligence plus character: that is the goal of true education.", author: "Martin Luther King Jr." },

  // ===== FRED ROGERS =====
  { text: "Often when you think you're at the end of something, you're at the beginning of something else.", author: "Fred Rogers" },
  { text: "There's no person in the whole world like you, and I like you just the way you are.", author: "Fred Rogers" },
  { text: "Anything that's human is mentionable, and anything that is mentionable can be more manageable.", author: "Fred Rogers" },
  { text: "Real strength has to do with helping others.", author: "Fred Rogers" },
  { text: "Play is often talked about as if it were a relief from serious learning. But for children, play is serious learning.", author: "Fred Rogers" },

  // ===== OPRAH WINFREY =====
  { text: "The biggest adventure you can take is to live the life of your dreams.", author: "Oprah Winfrey" },
  { text: "Turn your wounds into wisdom.", author: "Oprah Winfrey" },
  { text: "You become what you believe.", author: "Oprah Winfrey" },
  { text: "Doing the best at this moment puts you in the best place for the next moment.", author: "Oprah Winfrey" },
  { text: "Passion is energy. Feel the power that comes from focusing on what excites you.", author: "Oprah Winfrey" },
  { text: "Surround yourself with only people who are going to lift you higher.", author: "Oprah Winfrey" },

  // ===== DENZEL WASHINGTON =====
  { text: "Without commitment, you'll never start. Without consistency, you'll never finish.", author: "Denzel Washington" },
  { text: "Ease is a greater threat to progress than hardship.", author: "Denzel Washington" },
  { text: "Fall forward. Every failed experiment is one step closer to success.", author: "Denzel Washington" },
  { text: "Do what you have to do, to do what you want to do.", author: "Denzel Washington" },
  { text: "Dreams without goals are just dreams.", author: "Denzel Washington" },

  // ===== BRUCE LEE =====
  { text: "Do not pray for an easy life, pray for the strength to endure a difficult one.", author: "Bruce Lee" },
  { text: "The successful warrior is the average man, with laser-like focus.", author: "Bruce Lee" },
  { text: "I fear not the man who has practiced 10,000 kicks once, but I fear the man who has practiced one kick 10,000 times.", author: "Bruce Lee" },
  { text: "Adapt what is useful, reject what is useless, and add what is specifically your own.", author: "Bruce Lee" },
  { text: "Be water, my friend.", author: "Bruce Lee" },
  { text: "Knowing is not enough, we must apply. Willing is not enough, we must do.", author: "Bruce Lee" },
  { text: "Long-term consistency trumps short-term intensity.", author: "Bruce Lee" },
  { text: "If you spend too much time thinking about a thing, you'll never get it done.", author: "Bruce Lee" },

  // ===== JOHN WOODEN =====
  { text: "Do not let what you cannot do interfere with what you can do.", author: "John Wooden" },
  { text: "It's the little details that are vital. Little things make big things happen.", author: "John Wooden" },
  { text: "Failure is not fatal, but failure to change might be.", author: "John Wooden" },
  { text: "Don't measure yourself by what you have accomplished, but by what you should have accomplished with your ability.", author: "John Wooden" },
  { text: "Never mistake activity for achievement.", author: "John Wooden" },
  { text: "The most important key to achieving great success is to decide upon your goal and launch, get started, take action, move.", author: "John Wooden" },
  { text: "If you don't have time to do it right, when will you have time to do it over?", author: "John Wooden" },
  { text: "Make each day your masterpiece.", author: "John Wooden" },

  // ===== VINCE LOMBARDI =====
  { text: "Perfection is not attainable, but if we chase perfection we can catch excellence.", author: "Vince Lombardi" },
  { text: "It's not whether you get knocked down, it's whether you get up.", author: "Vince Lombardi" },
  { text: "The only place success comes before work is in the dictionary.", author: "Vince Lombardi" },
  { text: "Winners never quit and quitters never win.", author: "Vince Lombardi" },
  { text: "The measure of who we are is what we do with what we have.", author: "Vince Lombardi" },
  { text: "Individual commitment to a group effort: that is what makes a team work.", author: "Vince Lombardi" },
  { text: "Once you learn to quit, it becomes a habit.", author: "Vince Lombardi" },

  // ===== AMELIA EARHART =====
  { text: "The most effective way to do it, is to do it.", author: "Amelia Earhart" },
  { text: "Adventure is worthwhile in itself.", author: "Amelia Earhart" },
  { text: "Never interrupt someone doing what you said couldn't be done.", author: "Amelia Earhart" },
  { text: "The most difficult thing is the decision to act, the rest is merely tenacity.", author: "Amelia Earhart" },
  { text: "Some of us have great runways already built for us. If you have one, take off. But if you don't have one, realize it is your responsibility to grab a shovel and build one.", author: "Amelia Earhart" },

  // ===== HELEN KELLER =====
  { text: "Optimism is the faith that leads to achievement. Nothing can be done without hope and confidence.", author: "Helen Keller" },
  { text: "Alone we can do so little; together we can do so much.", author: "Helen Keller" },
  { text: "Keep your face to the sunshine and you cannot see a shadow.", author: "Helen Keller" },
  { text: "Life is either a daring adventure or nothing at all.", author: "Helen Keller" },
  { text: "Character cannot be developed in ease and quiet. Only through experience of trial and suffering can the soul be strengthened.", author: "Helen Keller" },
  { text: "The best and most beautiful things in the world cannot be seen or even touched. They must be felt with the heart.", author: "Helen Keller" },

  // ===== HENRY FORD =====
  { text: "Whether you think you can, or you think you can't, you're right.", author: "Henry Ford" },
  { text: "Nothing is particularly hard if you divide it into small jobs.", author: "Henry Ford" },
  { text: "When everything seems to be going against you, remember that the airplane takes off against the wind, not with it.", author: "Henry Ford" },
  { text: "Quality means doing it right when no one is looking.", author: "Henry Ford" },
  { text: "Failure is simply the opportunity to begin again, this time more intelligently.", author: "Henry Ford" },
  { text: "Anyone who stops learning is old, whether at twenty or eighty. Anyone who keeps learning stays young.", author: "Henry Ford" },
];

// ===================== LITERARY =====================
// Novelists, poets, and playwrights — on beginnings, persistence, and character.
const LITERARY: Quote[] = [
  // ===== WILLIAM SHAKESPEARE =====
  { text: "We know what we are, but know not what we may be.", author: "William Shakespeare" },
  { text: "It is not in the stars to hold our destiny but in ourselves.", author: "William Shakespeare" },
  { text: "All things are ready, if our mind be so.", author: "William Shakespeare" },
  { text: "Our doubts are traitors, and make us lose the good we oft might win, by fearing to attempt.", author: "William Shakespeare" },
  { text: "To thine own self be true.", author: "William Shakespeare" },
  { text: "Wisely and slow; they stumble that run fast.", author: "William Shakespeare" },
  { text: "There is nothing either good or bad, but thinking makes it so.", author: "William Shakespeare" },
  { text: "Better three hours too soon than a minute too late.", author: "William Shakespeare" },
  { text: "How poor are they that have not patience! What wound did ever heal but by degrees?", author: "William Shakespeare" },
  { text: "Some are born great, some achieve greatness, and some have greatness thrust upon them.", author: "William Shakespeare" },
  { text: "Action is eloquence.", author: "William Shakespeare" },
  { text: "The fool doth think he is wise, but the wise man knows himself to be a fool.", author: "William Shakespeare" },

  // ===== MARK TWAIN =====
  { text: "The secret of getting ahead is getting started.", author: "Mark Twain" },
  { text: "Continuous improvement is better than delayed perfection.", author: "Mark Twain" },
  { text: "Courage is resistance to fear, mastery of fear, not absence of fear.", author: "Mark Twain" },
  { text: "The two most important days in your life are the day you are born and the day you find out why.", author: "Mark Twain" },
  { text: "Twenty years from now you will be more disappointed by the things you didn't do than by the ones you did do.", author: "Mark Twain" },
  { text: "Kindness is the language which the deaf can hear and the blind can see.", author: "Mark Twain" },
  { text: "Never let your schooling interfere with your education.", author: "Mark Twain" },
  { text: "The man who does not read has no advantage over the man who cannot read.", author: "Mark Twain" },
  { text: "Do the right thing. It will gratify some people and astonish the rest.", author: "Mark Twain" },
  { text: "Keep away from people who try to belittle your ambitions. Small people always do that, but the really great make you feel that you, too, can become great.", author: "Mark Twain" },

  // ===== RALPH WALDO EMERSON =====
  { text: "Do not go where the path may lead, go instead where there is no path and leave a trail.", author: "Ralph Waldo Emerson" },
  { text: "What lies behind us and what lies before us are tiny matters compared to what lies within us.", author: "Ralph Waldo Emerson" },
  { text: "The only person you are destined to become is the person you decide to be.", author: "Ralph Waldo Emerson" },
  { text: "Adopt the pace of nature: her secret is patience.", author: "Ralph Waldo Emerson" },
  { text: "Do the thing and you will have the power.", author: "Ralph Waldo Emerson" },
  { text: "Every artist was first an amateur.", author: "Ralph Waldo Emerson" },
  { text: "Write it on your heart that every day is the best day in the year.", author: "Ralph Waldo Emerson" },
  { text: "To be yourself in a world that is constantly trying to make you something else is the greatest accomplishment.", author: "Ralph Waldo Emerson" },
  { text: "Nothing great was ever achieved without enthusiasm.", author: "Ralph Waldo Emerson" },
  { text: "Once you make a decision, the universe conspires to make it happen.", author: "Ralph Waldo Emerson" },

  // ===== HENRY DAVID THOREAU =====
  { text: "Go confidently in the direction of your dreams. Live the life you have imagined.", author: "Henry David Thoreau" },
  { text: "Success usually comes to those who are too busy to be looking for it.", author: "Henry David Thoreau" },
  { text: "It's not what you look at that matters, it's what you see.", author: "Henry David Thoreau" },
  { text: "What you get by achieving your goals is not as important as what you become by achieving your goals.", author: "Henry David Thoreau" },
  { text: "Never look back unless you are planning to go that way.", author: "Henry David Thoreau" },
  { text: "If one advances confidently in the direction of his dreams, he will meet with a success unexpected in common hours.", author: "Henry David Thoreau" },
  { text: "The price of anything is the amount of life you exchange for it.", author: "Henry David Thoreau" },
  { text: "Live your beliefs and you can turn the world around.", author: "Henry David Thoreau" },

  // ===== OSCAR WILDE =====
  { text: "Be yourself; everyone else is already taken.", author: "Oscar Wilde" },
  { text: "The smallest act of kindness is worth more than the grandest intention.", author: "Oscar Wilde" },
  { text: "We are all in the gutter, but some of us are looking at the stars.", author: "Oscar Wilde" },
  { text: "Experience is simply the name we give our mistakes.", author: "Oscar Wilde" },
  { text: "To live is the rarest thing in the world. Most people exist, that is all.", author: "Oscar Wilde" },
  { text: "Success is a science; if you have the conditions, you get the result.", author: "Oscar Wilde" },
  { text: "You can never be overdressed or overeducated.", author: "Oscar Wilde" },

  // ===== C.S. LEWIS =====
  { text: "You are never too old to set another goal or to dream a new dream.", author: "C.S. Lewis" },
  { text: "Hardships often prepare ordinary people for an extraordinary destiny.", author: "C.S. Lewis" },
  { text: "You can't go back and change the beginning, but you can start where you are and change the ending.", author: "C.S. Lewis" },
  { text: "Isn't it funny how day by day nothing changes but when you look back, everything is different?", author: "C.S. Lewis" },
  { text: "Integrity is doing the right thing, even when no one is watching.", author: "C.S. Lewis" },
  { text: "Courage, dear heart.", author: "C.S. Lewis" },
  { text: "There are far, far better things ahead than any we leave behind.", author: "C.S. Lewis" },
  { text: "Failures are finger posts on the road to achievement.", author: "C.S. Lewis" },

  // ===== J.R.R. TOLKIEN =====
  { text: "Even the smallest person can change the course of the future.", author: "J.R.R. Tolkien" },
  { text: "All we have to decide is what to do with the time that is given us.", author: "J.R.R. Tolkien" },
  { text: "Not all those who wander are lost.", author: "J.R.R. Tolkien" },
  { text: "It's the job that's never started as takes longest to finish.", author: "J.R.R. Tolkien" },
  { text: "Courage is found in unlikely places.", author: "J.R.R. Tolkien" },
  { text: "Little by little, one travels far.", author: "J.R.R. Tolkien" },

  // ===== CHARLES DICKENS =====
  { text: "No one is useless in this world who lightens the burdens of another.", author: "Charles Dickens" },
  { text: "The sum of the whole is this: walk and be happy; walk and be healthy.", author: "Charles Dickens" },
  { text: "A very little key will open a very heavy door.", author: "Charles Dickens" },
  { text: "I will honour Christmas in my heart, and try to keep it all the year.", author: "Charles Dickens" },
  { text: "Procrastination is the thief of time. Collar him.", author: "Charles Dickens" },

  // ===== JANE AUSTEN =====
  { text: "It isn't what we say or think that defines us, but what we do.", author: "Jane Austen" },
  { text: "There is no charm equal to tenderness of heart.", author: "Jane Austen" },
  { text: "Know your own happiness. Want for nothing but patience, or give it a more fascinating name: call it hope.", author: "Jane Austen" },
  { text: "I hate to hear you talk about all women as if they were fine ladies instead of rational creatures.", author: "Jane Austen" },
  { text: "We have all a better guide in ourselves, if we would attend to it, than any other person can be.", author: "Jane Austen" },

  // ===== EMILY DICKINSON =====
  { text: "Hope is the thing with feathers that perches in the soul.", author: "Emily Dickinson" },
  { text: "We never know how high we are till we are called to rise.", author: "Emily Dickinson" },
  { text: "Dwell in possibility.", author: "Emily Dickinson" },
  { text: "Forever is composed of nows.", author: "Emily Dickinson" },
  { text: "If your nerve deny you, go above your nerve.", author: "Emily Dickinson" },

  // ===== ROBERT FROST =====
  { text: "The best way out is always through.", author: "Robert Frost" },
  { text: "Two roads diverged in a wood, and I took the one less traveled by, and that has made all the difference.", author: "Robert Frost" },
  { text: "In three words I can sum up everything I've learned about life: it goes on.", author: "Robert Frost" },
  { text: "The only way around is through.", author: "Robert Frost" },
  { text: "Freedom lies in being bold.", author: "Robert Frost" },

  // ===== ERNEST HEMINGWAY =====
  { text: "There is nothing noble in being superior to your fellow man; true nobility is being superior to your former self.", author: "Ernest Hemingway" },
  { text: "Courage is grace under pressure.", author: "Ernest Hemingway" },
  { text: "The world breaks everyone, and afterward, many are strong at the broken places.", author: "Ernest Hemingway" },
  { text: "Now is no time to think of what you do not have. Think of what you can do with what there is.", author: "Ernest Hemingway" },
  { text: "The first draft of anything is rubbish. Rewrite it.", author: "Ernest Hemingway" },
  { text: "Never mistake motion for action.", author: "Ernest Hemingway" },

  // ===== F. SCOTT FITZGERALD =====
  { text: "It is never too late to be whoever you want to be.", author: "F. Scott Fitzgerald" },
  { text: "Vitality shows in not only the ability to persist but the ability to start over.", author: "F. Scott Fitzgerald" },
  { text: "You don't write because you want to say something, you write because you have something to say.", author: "F. Scott Fitzgerald" },
  { text: "Never confuse a single defeat with a final defeat.", author: "F. Scott Fitzgerald" },

  // ===== VICTOR HUGO =====
  { text: "Even the darkest night will end and the sun will rise.", author: "Victor Hugo" },
  { text: "Perseverance, secret of all triumphs.", author: "Victor Hugo" },
  { text: "He who opens a school door, closes a prison.", author: "Victor Hugo" },
  { text: "There is nothing like a dream to create the future.", author: "Victor Hugo" },
  { text: "Music expresses that which cannot be put into words and that which cannot remain silent.", author: "Victor Hugo" },
  { text: "Nothing is more powerful than an idea whose time has come.", author: "Victor Hugo" },

  // ===== LEO TOLSTOY =====
  { text: "Everyone thinks of changing the world, but no one thinks of changing himself.", author: "Leo Tolstoy" },
  { text: "The two most powerful warriors are patience and time.", author: "Leo Tolstoy" },
  { text: "True life is lived when tiny changes occur.", author: "Leo Tolstoy" },
  { text: "There is no greatness where there is not simplicity, goodness, and truth.", author: "Leo Tolstoy" },
  { text: "If you want to be happy, be.", author: "Leo Tolstoy" },

  // ===== FYODOR DOSTOEVSKY =====
  { text: "The mystery of human existence lies not in just staying alive, but in finding something to live for.", author: "Fyodor Dostoevsky" },
  { text: "To live without hope is to cease to live.", author: "Fyodor Dostoevsky" },
  { text: "Taking a new step, uttering a new word, is what people fear most.", author: "Fyodor Dostoevsky" },
  { text: "The soul is healed by being with children.", author: "Fyodor Dostoevsky" },

  // ===== DR. SEUSS =====
  { text: "You have brains in your head. You have feet in your shoes. You can steer yourself any direction you choose.", author: "Dr. Seuss" },
  { text: "Why fit in when you were born to stand out?", author: "Dr. Seuss" },
  { text: "The more that you read, the more things you will know. The more that you learn, the more places you'll go.", author: "Dr. Seuss" },
  { text: "Unless someone like you cares a whole awful lot, nothing is going to get better. It's not.", author: "Dr. Seuss" },
  { text: "Today you are you, that is truer than true. There is no one alive who is youer than you.", author: "Dr. Seuss" },

  // ===== LEWIS CARROLL =====
  { text: "In the end, we only regret the chances we didn't take.", author: "Lewis Carroll" },
  { text: "It's no use going back to yesterday, because I was a different person then.", author: "Lewis Carroll" },
  { text: "Everything's got a moral, if only you can find it.", author: "Lewis Carroll" },
  { text: "Sometimes I've believed as many as six impossible things before breakfast.", author: "Lewis Carroll" },

  // ===== LOUISA MAY ALCOTT =====
  { text: "I am not afraid of storms, for I am learning how to sail my ship.", author: "Louisa May Alcott" },
  { text: "Have regular hours for work and play; make each day both useful and pleasant.", author: "Louisa May Alcott" },
  { text: "Far away there in the sunshine are my highest aspirations. I may not reach them, but I can look up and see their beauty.", author: "Louisa May Alcott" },
  { text: "Painful as it may be, a significant emotional event can be the catalyst for choosing a direction that serves us better.", author: "Louisa May Alcott" },

  // ===== GEORGE ELIOT =====
  { text: "It is never too late to be what you might have been.", author: "George Eliot" },
  { text: "What do we live for, if it is not to make life less difficult for each other?", author: "George Eliot" },
  { text: "The strongest principle of growth lies in human choice.", author: "George Eliot" },
  { text: "Our deeds determine us, as much as we determine our deeds.", author: "George Eliot" },

  // ===== RAINER MARIA RILKE =====
  { text: "The only journey is the one within.", author: "Rainer Maria Rilke" },
  { text: "Be patient toward all that is unsolved in your heart and try to love the questions themselves.", author: "Rainer Maria Rilke" },
  { text: "Perhaps all the dragons in our lives are princesses who are only waiting to see us act, just once, with beauty and courage.", author: "Rainer Maria Rilke" },

  // ===== KAHLIL GIBRAN =====
  { text: "Your living is determined not so much by what life brings to you as by the attitude you bring to life.", author: "Kahlil Gibran" },
  { text: "Out of suffering have emerged the strongest souls; the most massive characters are seared with scars.", author: "Kahlil Gibran" },
  { text: "Work is love made visible.", author: "Kahlil Gibran" },
  { text: "Progress lies not in enhancing what is, but in advancing toward what will be.", author: "Kahlil Gibran" },
];

// ===================== SCIENCE & DISCOVERY =====================
// Scientists, inventors, and explorers — on curiosity, persistence, and wonder.
const SCIENCE: Quote[] = [
  // ===== ALBERT EINSTEIN =====
  { text: "Life is like riding a bicycle. To keep your balance, you must keep moving.", author: "Albert Einstein" },
  { text: "I have no special talent. I am only passionately curious.", author: "Albert Einstein" },
  { text: "In the middle of difficulty lies opportunity.", author: "Albert Einstein" },
  { text: "Imagination is more important than knowledge. Knowledge is limited; imagination embraces the entire world.", author: "Albert Einstein" },
  { text: "A person who never made a mistake never tried anything new.", author: "Albert Einstein" },
  { text: "Try not to become a person of success, but rather try to become a person of value.", author: "Albert Einstein" },
  { text: "The important thing is not to stop questioning. Curiosity has its own reason for existing.", author: "Albert Einstein" },
  { text: "It's not that I'm so smart, it's just that I stay with problems longer.", author: "Albert Einstein" },
  { text: "Anyone who has never made a mistake has never tried anything new.", author: "Albert Einstein" },
  { text: "Learn from yesterday, live for today, hope for tomorrow.", author: "Albert Einstein" },
  { text: "The measure of intelligence is the ability to change.", author: "Albert Einstein" },
  { text: "Once we accept our limits, we go beyond them.", author: "Albert Einstein" },
  { text: "Education is not the learning of facts, but the training of the mind to think.", author: "Albert Einstein" },

  // ===== MARIE CURIE =====
  { text: "Nothing in life is to be feared, it is only to be understood. Now is the time to understand more, so that we may fear less.", author: "Marie Curie" },
  { text: "Be less curious about people and more curious about ideas.", author: "Marie Curie" },
  { text: "I was taught that the way of progress was neither swift nor easy.", author: "Marie Curie" },
  { text: "Life is not easy for any of us. But what of that? We must have perseverance and above all confidence in ourselves.", author: "Marie Curie" },
  { text: "One never notices what has been done; one can only see what remains to be done.", author: "Marie Curie" },
  { text: "We must believe that we are gifted for something, and that this thing, at whatever cost, must be attained.", author: "Marie Curie" },
  { text: "I am among those who think that science has great beauty.", author: "Marie Curie" },
  { text: "Have no fear of perfection; you'll never reach it.", author: "Marie Curie" },

  // ===== ISAAC NEWTON =====
  { text: "If I have seen further it is by standing on the shoulders of giants.", author: "Isaac Newton" },
  { text: "What we know is a drop, what we don't know is an ocean.", author: "Isaac Newton" },
  { text: "Truth is ever to be found in simplicity, and not in the multiplicity and confusion of things.", author: "Isaac Newton" },
  { text: "If I have done the public any service, it is due to my patient thought.", author: "Isaac Newton" },
  { text: "To myself I am only a child playing on the beach, while vast oceans of truth lie undiscovered before me.", author: "Isaac Newton" },

  // ===== RICHARD FEYNMAN =====
  { text: "I would rather have questions that can't be answered than answers that can't be questioned.", author: "Richard Feynman" },
  { text: "The first principle is that you must not fool yourself, and you are the easiest person to fool.", author: "Richard Feynman" },
  { text: "Study hard what interests you the most in the most undisciplined, irreverent and original manner possible.", author: "Richard Feynman" },
  { text: "Fall in love with some activity, and do it!", author: "Richard Feynman" },
  { text: "Nature uses only the longest threads to weave her patterns, so each small piece of her fabric reveals the organization of the entire tapestry.", author: "Richard Feynman" },
  { text: "I learned very early the difference between knowing the name of something and knowing something.", author: "Richard Feynman" },
  { text: "What I cannot create, I do not understand.", author: "Richard Feynman" },
  { text: "The pleasure of finding things out is the greatest reward.", author: "Richard Feynman" },

  // ===== CARL SAGAN =====
  { text: "Somewhere, something incredible is waiting to be known.", author: "Carl Sagan" },
  { text: "Imagination will often carry us to worlds that never were. But without it we go nowhere.", author: "Carl Sagan" },
  { text: "We are made of star-stuff. We are a way for the universe to know itself.", author: "Carl Sagan" },
  { text: "Science is a way of thinking much more than it is a body of knowledge.", author: "Carl Sagan" },
  { text: "Understanding is a kind of ecstasy.", author: "Carl Sagan" },
  { text: "The universe is not required to be in perfect harmony with human ambition.", author: "Carl Sagan" },
  { text: "For small creatures such as we, the vastness is bearable only through love.", author: "Carl Sagan" },
  { text: "Every one of us is, in the cosmic perspective, precious.", author: "Carl Sagan" },

  // ===== STEPHEN HAWKING =====
  { text: "However difficult life may seem, there is always something you can do and succeed at.", author: "Stephen Hawking" },
  { text: "Intelligence is the ability to adapt to change.", author: "Stephen Hawking" },
  { text: "Look up at the stars and not down at your feet. Try to make sense of what you see, and wonder about what makes the universe exist. Be curious.", author: "Stephen Hawking" },
  { text: "Quiet people have the loudest minds.", author: "Stephen Hawking" },
  { text: "One, remember to look up at the stars and not down at your feet. Two, never give up work. Work gives you meaning and purpose.", author: "Stephen Hawking" },
  { text: "While there's life, there is hope.", author: "Stephen Hawking" },
  { text: "It matters that you don't just give up.", author: "Stephen Hawking" },

  // ===== NIKOLA TESLA =====
  { text: "The present is theirs; the future, for which I really worked, is mine.", author: "Nikola Tesla" },
  { text: "I don't care that they stole my idea. I care that they don't have any of their own.", author: "Nikola Tesla" },
  { text: "If you want to find the secrets of the universe, think in terms of energy, frequency and vibration.", author: "Nikola Tesla" },
  { text: "Our virtues and our failings are inseparable, like force and matter.", author: "Nikola Tesla" },
  { text: "Invention is the most important product of man's creative brain.", author: "Nikola Tesla" },

  // ===== THOMAS EDISON =====
  { text: "Genius is one percent inspiration and ninety-nine percent perspiration.", author: "Thomas Edison" },
  { text: "I have not failed. I've just found 10,000 ways that won't work.", author: "Thomas Edison" },
  { text: "Our greatest weakness lies in giving up. The most certain way to succeed is always to try just one more time.", author: "Thomas Edison" },
  { text: "Opportunity is missed by most people because it is dressed in overalls and looks like work.", author: "Thomas Edison" },
  { text: "There is no substitute for hard work.", author: "Thomas Edison" },
  { text: "Many of life's failures are people who did not realize how close they were to success when they gave up.", author: "Thomas Edison" },
  { text: "What you are will show in what you do.", author: "Thomas Edison" },
  { text: "The value of an idea lies in the using of it.", author: "Thomas Edison" },

  // ===== CHARLES DARWIN =====
  { text: "It is not the strongest of the species that survives, but the one most responsive to change.", author: "Charles Darwin" },
  { text: "A man who dares to waste one hour of time has not discovered the value of life.", author: "Charles Darwin" },
  { text: "In the long history of humankind, those who learned to collaborate and improvise most effectively have prevailed.", author: "Charles Darwin" },
  { text: "The love for all living creatures is the most noble attribute of man.", author: "Charles Darwin" },

  // ===== GALILEO GALILEI =====
  { text: "All truths are easy to understand once they are discovered; the point is to discover them.", author: "Galileo Galilei" },
  { text: "You cannot teach a man anything; you can only help him find it within himself.", author: "Galileo Galilei" },
  { text: "Doubt is the father of invention.", author: "Galileo Galilei" },
  { text: "Measure what is measurable, and make measurable what is not so.", author: "Galileo Galilei" },
  { text: "Passion is the genesis of genius.", author: "Galileo Galilei" },

  // ===== LEONARDO DA VINCI =====
  { text: "Learning never exhausts the mind.", author: "Leonardo da Vinci" },
  { text: "Simplicity is the ultimate sophistication.", author: "Leonardo da Vinci" },
  { text: "It had long since come to my attention that people of accomplishment rarely sat back and let things happen to them. They went out and happened to things.", author: "Leonardo da Vinci" },
  { text: "Obstacles cannot crush me; every obstacle yields to stern resolve.", author: "Leonardo da Vinci" },
  { text: "Time stays long enough for anyone who will use it.", author: "Leonardo da Vinci" },
  { text: "I have been impressed with the urgency of doing. Knowing is not enough; we must apply. Being willing is not enough; we must do.", author: "Leonardo da Vinci" },
  { text: "Study without desire spoils the memory, and it retains nothing that it takes in.", author: "Leonardo da Vinci" },
  { text: "The noblest pleasure is the joy of understanding.", author: "Leonardo da Vinci" },

  // ===== JANE GOODALL =====
  { text: "What you do makes a difference, and you have to decide what kind of difference you want to make.", author: "Jane Goodall" },
  { text: "Every individual matters. Every individual has a role to play.", author: "Jane Goodall" },
  { text: "Change happens by listening and then starting a dialogue with the people who are doing something you don't believe is right.", author: "Jane Goodall" },
  { text: "The least I can do is speak out for those who cannot speak for themselves.", author: "Jane Goodall" },
  { text: "Only if we understand, will we care. Only if we care, will we help.", author: "Jane Goodall" },

  // ===== NEIL DEGRASSE TYSON =====
  { text: "The good thing about science is that it's true whether or not you believe in it.", author: "Neil deGrasse Tyson" },
  { text: "Curious that we spend more time congratulating people who have succeeded than encouraging people who have not.", author: "Neil deGrasse Tyson" },
  { text: "Know more today about the world than I knew yesterday and lessen the suffering of others. You'd be surprised how far that gets you.", author: "Neil deGrasse Tyson" },
  { text: "The Universe is under no obligation to make sense to you.", author: "Neil deGrasse Tyson" },

  // ===== KATHERINE JOHNSON =====
  { text: "Like what you do, and then you will do your best.", author: "Katherine Johnson" },
  { text: "Take all the courses in your curriculum. Do the research. Ask questions. Find someone doing what you are interested in.", author: "Katherine Johnson" },
  { text: "I don't have a feeling of inferiority. Never had. I'm as good as anybody, but no better.", author: "Katherine Johnson" },

  // ===== MAE JEMISON =====
  { text: "Never limit yourself because of others' limited imagination; never limit others because of your own limited imagination.", author: "Mae Jemison" },
  { text: "It's your place in the world; it's your life. Go on and do all you can with it.", author: "Mae Jemison" },
  { text: "Don't let anyone rob you of your imagination, your creativity, or your curiosity.", author: "Mae Jemison" },

  // ===== ADA LOVELACE =====
  { text: "Your best and wisest refuge from all troubles is in your science.", author: "Ada Lovelace" },
  { text: "That brain of mine is something more than merely mortal, as time will show.", author: "Ada Lovelace" },
  { text: "Understand well as I may, my comprehension can only be an infinitesimal fraction of all I want to understand.", author: "Ada Lovelace" },

  // ===== ALAN TURING =====
  { text: "Those who can imagine anything, can create the impossible.", author: "Alan Turing" },
  { text: "We can only see a short distance ahead, but we can see plenty there that needs to be done.", author: "Alan Turing" },
  { text: "Sometimes it is the people no one can imagine anything of who do the things no one can imagine.", author: "Alan Turing" },

  // ===== LOUIS PASTEUR =====
  { text: "Chance favors the prepared mind.", author: "Louis Pasteur" },
  { text: "Let me tell you the secret that has led me to my goal: my strength lies solely in my tenacity.", author: "Louis Pasteur" },
  { text: "Science knows no country, because knowledge belongs to humanity, and is the torch which illuminates the world.", author: "Louis Pasteur" },

  // ===== GEORGE WASHINGTON CARVER =====
  { text: "Education is the key to unlock the golden door of freedom.", author: "George Washington Carver" },
  { text: "Where there is no vision, there is no hope.", author: "George Washington Carver" },
  { text: "Ninety-nine percent of the failures come from people who have the habit of making excuses.", author: "George Washington Carver" },
  { text: "Start where you are, with what you have. Make something of it and never be satisfied.", author: "George Washington Carver" },

  // ===== BENJAMIN FRANKLIN =====
  { text: "Well done is better than well said.", author: "Benjamin Franklin" },
  { text: "An investment in knowledge pays the best interest.", author: "Benjamin Franklin" },
  { text: "By failing to prepare, you are preparing to fail.", author: "Benjamin Franklin" },
  { text: "Tell me and I forget. Teach me and I remember. Involve me and I learn.", author: "Benjamin Franklin" },
  { text: "Energy and persistence conquer all things.", author: "Benjamin Franklin" },
  { text: "Lost time is never found again.", author: "Benjamin Franklin" },
  { text: "Either write something worth reading or do something worth writing.", author: "Benjamin Franklin" },
  { text: "Diligence is the mother of good luck.", author: "Benjamin Franklin" },

  // ===== SALLY RIDE =====
  { text: "Reach for the stars, even if you have to stand on a cactus.", author: "Sally Ride" },
  { text: "You can't be what you can't see.", author: "Sally Ride" },
  { text: "Science is fun. Science is curiosity. We all have natural curiosity.", author: "Sally Ride" },

  // ===== NEIL ARMSTRONG =====
  { text: "That's one small step for man, one giant leap for mankind.", author: "Neil Armstrong" },
  { text: "Research is creating new knowledge.", author: "Neil Armstrong" },
  { text: "I believe every human has a finite number of heartbeats. I don't intend to waste any of mine.", author: "Neil Armstrong" },

  // ===== RACHEL CARSON =====
  { text: "In every outthrust headland, in every curving beach, in every grain of sand there is the story of the earth.", author: "Rachel Carson" },
  { text: "The more clearly we can focus our attention on the wonders and realities of the universe about us, the less taste we shall have for destruction.", author: "Rachel Carson" },
  { text: "Those who contemplate the beauty of the earth find reserves of strength that will endure as long as life lasts.", author: "Rachel Carson" },

  // ===== JOHANNES KEPLER =====
  { text: "Truth is the daughter of time, and I feel no shame in being her midwife.", author: "Johannes Kepler" },
  { text: "Nature uses as little as possible of anything.", author: "Johannes Kepler" },

  // ===== MICHAEL FARADAY =====
  { text: "Nothing is too wonderful to be true, if it be consistent with the laws of nature.", author: "Michael Faraday" },
  { text: "But still try, for who knows what is possible.", author: "Michael Faraday" },
];

// ---------------------------------------------------------------------------

/** The source arrays are grouped by author. Interleave round-robin across
 *  authors so consecutive days rotate through different voices instead of
 *  marching through one author's whole block. Built once at load; the daily
 *  pick stays deterministic (one quote per calendar day). */
function interleaveByAuthor(src: Quote[]): Quote[] {
  const byAuthor = new Map<string, Quote[]>();
  for (const q of src) {
    (byAuthor.get(q.author) ?? byAuthor.set(q.author, []).get(q.author)!).push(q);
  }
  const buckets = [...byAuthor.values()];
  const out: Quote[] = [];
  for (let i = 0; out.length < src.length; i++) {
    for (const b of buckets) if (i < b.length) out.push(b[i]);
  }
  return out;
}

const ROTATIONS: Record<Exclude<QuoteStyle, 'mixed'>, Quote[]> = {
  stoic: interleaveByAuthor(STOIC),
  modern: interleaveByAuthor(MODERN),
  literary: interleaveByAuthor(LITERARY),
  science: interleaveByAuthor(SCIENCE),
};

// Mixed hops styles day to day: stoic → modern → literary → science → stoic → …
const MIXED: Quote[] = (() => {
  const lists = [ROTATIONS.stoic, ROTATIONS.modern, ROTATIONS.literary, ROTATIONS.science];
  const out: Quote[] = [];
  const longest = Math.max(...lists.map((l) => l.length));
  for (let i = 0; i < longest; i++) {
    for (const l of lists) if (i < l.length) out.push(l[i]);
  }
  return out;
})();

function dayOfYear(): number {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  return Math.floor((now.getTime() - start.getTime()) / 86400000);
}

/** The day's quote for a style (Settings ▸ Quote style). Deterministic per day. */
export function quoteOfDay(style: QuoteStyle): Quote {
  const list = style === 'mixed' ? MIXED : ROTATIONS[style];
  return list[dayOfYear() % list.length];
}
