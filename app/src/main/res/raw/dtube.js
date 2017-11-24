//A callback function
//checks the user credintials At login
function login(username, password){
	steem.api.getAccounts([username], function(err, result) {
		try{
			var pubWif = result[0].posting.key_auths[0][0];
			var isvalid = steem.auth.wifIsValid(password, pubWif);

			if(isvalid == true){
				console.log('Welcome '+name);
			}else{
				console.log('Wrong! Check your Private key.');
			}

			androidAppProxy.loginCallback(isvalid);
		}catch(e){
			androidAppProxy.loginCallback(false);
		}
	});
}


//A callback function
//gets a list of subscriptions the user is subscribed to
function getSubscriptions(username){
	//cannot return due to asyncronoyse task
	steem.api.getFollowing(username, 0, "blog", 100, function(err, result) {
		var users = [];
		for (u =0; u<result.length; u++){
			users.push(result[u].following);
		}
		androidAppProxy.getSubscriptionsCallback(users);
	});
}


//A callback function
//gets the number of subscribers the user has
function getSubscriberCount(username){
	steem.api.getFollowCount(username, function(err, result) {
		androidAppProxy.getSubscriberCountCallback(username, result.follower_count);
	});
}



//A callback function
//gets weather the user is following a specific author
function getIsFollowing(author, accountName){
	steem.api.getFollowing("immawake", 0, "blog", 100, function(err, result) {
		var following = false;
		for (i in result){
			if (result[i].following == author){
				console.log("You are following "+author);
				following = true;
				break;
			}
		}
		androidAppProxy.getIsFollowingCallback(following, author);
	});
}



//A special callback function getIsFollowingCallback
//follows an author and then sends getIsFollowingCallback true
function followAuthor(author, accountName, privateKey){
	var followReq = ["follow"]
	followReq.push({follower: accountName, following: author, what: ["blog"]})

	const customJson = JSON.stringify(followReq)

	steem.broadcast.customJsonAsync(privateKey, [], [accountName], "follow", customJson, function(err, result) {
  		androidAppProxy.getIsFollowingCallback(true, author);
	});
}



//A special callback function getIsFollowingCallback
//follows an author and then sends getIsFollowingCallback false
function unfollowAuthor(author, accountName, privateKey){
	var followReq = ["follow"]
	followReq.push({follower: accountName, following: author, what: [""]})

	const customJson = JSON.stringify(followReq)

	steem.broadcast.customJsonAsync(privateKey, [], [accountName], "follow", customJson, function(err, result) {
  		androidAppProxy.getIsFollowingCallback(false, author);
	});
}


//A callback function
//votes on a specific post/video/reply then sends back voteWeight and the permlink
function votePost(author, permlink, accountName, privateKey, weight){
	steem.broadcast.vote(privateKey, accountName, author, permlink, weight, function(err, result) {
		console.log(err, result);
		androidAppProxy.votePostCallback(weight, permlink);
	});
}



//A special callback function
//Adds a comment to a post/video/reply and then sends getAllRepliesCallback
function commentPost(author, permlink, accountName, privateKey, comment, parentPermlink, parentAuthor){
	var newPermlink = new Date().toISOString().replace(/[^a-zA-Z0-9]+/g, '').toLowerCase();

	steem.broadcast.comment(
		privateKey,
		author, // Parent Author
		permlink, // Parent Permlink
		accountName, // Author
		newPermlink, // Permlink
		'', // Title
		comment, // Body,
		{ tags: [], app: 'steemjs/dtubemobileapp' }, // Json Metadata
		function(err, result) {
			console.log(err, result);
			getAllReplies(parentAuthor, parentPermlink, accountName);
		}
  	);
}




//A callback function
//gets video information required for playback & description
function getVideoInfo(author, permlink, accountName){
	steem.api.getContent(author, permlink,  function(err, b){
		console.log(err, b);
		androidAppProxy.getVideoInfoCallback(JSON.stringify(getAdvancedVideoObject(b, accountName)));
	});
}



//A callback function
//gets all replies on a post plus replies to replies
//and sends an easy workable array of comment Objects
function getAllReplies(author, permlink, accountName){
  var comments = [];

  // Eagerly fetch all of the descendant replies (recursively)
  var fetchReplies = function (author, permlink) {
    return steem.api.getContentReplies(author, permlink)
      .then(function (replies) {
        return Promise.map(replies, function (r) {
          if (r.children > 0) {
            return fetchReplies(r.author, r.permlink)
              .then(function (children) {
                r.replies = children;
                return r;
              })
          } else {
            return r;
          }
        });
      });
  }

  steem.api.getContentAsync(author, permlink)
    .then(function (post) {
      return fetchReplies(author, permlink)
        .then(function (comments) {
          post.replies = comments;
          return post;
        });
    })
    .then(function (post) {
	//create a comparator to sort by net_votes
	function compare(a, b){
	  var comparison = 0;

	  if (a.net_votes > b.net_votes) {
	    comparison = -1;
	  } else if (b.net_votes > a.net_votes) {
	    comparison = 1;
	  }

	  return comparison;
	}

	//sort replies by net_vote
	post.replies.sort(compare);

	//now add likes and dislikes to the comments
	var repliesObject = getCommentsObject(post.replies, 0);
	var promises = repliesObject.map(function(name) {
		return steem.api.getActiveVotes(name.author, name.permlink, function(err, r) {

			var likes = 0;
			var dislikes = 0;

			//0=no vote
			//1=vote up
			//-1=vote down
			var voteType = 0;

			var vote;
			for (voteIndex in r) {
				vote =  r[voteIndex];

				if (vote.percent>0)
					likes++;
				else if (vote.percent<0)
					dislikes++;

				if (vote.voter == accountName){
					if (vote.percent>0)
						voteType = 1;
					else if (vote.percent<0)
						voteType = -1;
				}
			}

			name.likes = likes;
			name.dislikes = dislikes;
			name.voteType = voteType;
		});

	});

	Promise.all(promises)
	.then(function() {
		//console.log(repliesObject);
		androidAppProxy.getAllRepliesCallback(JSON.stringify(repliesObject));
	}).error(console.error);
	 	return post;
    	}).catch(console.log);
}



//A callback function
//gets 20 posts from an author and filters non-dtube posts
//if dtube posts length is 0 then it gets the next set of posts without notification
//to start getting videos have lastPermlink=''
//sends videoObjects array and the last permlink in post list
function getAuthorVideos(author, lastPermlink){
	var d = new Date();
	d.setTime( d.getTime() + d.getTimezoneOffset()*60*1000 );
	var dateString = dateFormat(d, "yyyy-mm-dd'T'HH:MM:ss");

	steem.api.getDiscussionsByAuthorBeforeDate(author,lastPermlink,dateString,20, function(err, result) {

		if (result.length > 0){
			var newLastPermlink = result[result.length-1].permlink;
			if (newLastPermlink != lastPermlink){
				//remove first element because it is a duplicate of lastPermlink
				if (lastPermlink != "")
					result.shift()
				var videos = [];
				for (i in result){
					if (result[i].category == "dtube"){
						//dtube permlinks have a length of 8
						if (result[i].permlink.length == 8){
							if (isVideoViewable(result[i])){
								videos.push(getSimpleVideoObject(result[i]));
							}
						}
					}
				}
				console.log(err,"found " + videos.length +" videos from author");

				//let client know of new posts and the last permlink
				if (videos.length == 0)
					getAuthorPosts(author, newLastPermlink);
				else
					androidAppProxy.getAuthorVideosCallback(JSON.stringify(videos), newLastPermlink);

			}else{
				//let client know nothing else needs to load
				androidAppProxy.getAuthorVideosCallback("last", "last");
			}
		}
	});
}




//A callback function
//gets 6 of the latest videos from a specific author
function getSuggestedVideos(author){
	var d = new Date();
			d.setTime( d.getTime() + d.getTimezoneOffset()*60*1000 );
			var dateString = dateFormat(d, "yyyy-mm-dd'T'HH:MM:ss");

	steem.api.getDiscussionsByAuthorBeforeDate(author,"",dateString,100).then(function (result) {
		var videos = [];
		for (i in result){
			if (result[i].category == "dtube"){
				//dtube permlinks
				if (result[i].permlink.length == 8){
					if (isVideoViewable(result[i])){
						videos.push(getSimpleVideoObject(result[i]));
						if (videos.length == 6)
							break;
					}
				}
			}
		}
		if (videos.length > 0){
			console.log("suggested videos for" + author + " loaded");
			androidAppProxy.getSuggestedVideosCallback(JSON.stringify(videos));
		}
	}).catch(console.log);
}



//A callback function
//gets a set of videos from each subscription and sends them as chunks
function getSubscriptionFeed(username){
	//first get a list of subscriptions
	steem.api.getFollowing(username, 0, "blog", 100, function(err, result) {

		//the more the subscribers the less videos from each sub
		var numberOfVideosToGetFromEachSub = 50/result.length;
		var numberOfItemsToProcess = 100/(result.length/2);

		if (numberOfVideosToGetFromEachSub<4)
			numberOfVideosToGetFromEachSub = 4;

		if (numberOfItemsToProcess<20)
			numberOfItemsToProcess = 20;

		if (numberOfItemsToProcess>100)
			numberOfItemsToProcess = 100;


		for (u = 0; u<result.length; u++){
			//get some videos from all subscriptions result[u].following
			var d = new Date();
			d.setTime( d.getTime() + d.getTimezoneOffset()*60*1000);
			var dateString = dateFormat(d, "yyyy-mm-dd'T'HH:MM:ss");

			steem.api.getDiscussionsByAuthorBeforeDate(result[u].following,"",dateString,numberOfItemsToProcess).then(function (result) {
				var videos = [];
				for (i in result){
					if (result[i].category == "dtube"){
						//dtube permlinks
						if (result[i].permlink.length == 8){
							if (isVideoViewable(result[i])){
								videos.push(getSimpleVideoObject(result[i]));
								if (videos.length == numberOfVideosToGetFromEachSub)
									break;
							}
						}
					}
				}
				if (videos.length > 0){
					console.log("subscription feed for" + videos[0].username + "loaded");
					//app will load one set of subscriptions at a time
					androidAppProxy.getSubscriptionFeedCallback(JSON.stringify(videos));
				}
			}).catch(console.log);
		}
	});
}



//A callback function
//gets a set of videos and sends as a single chunk
function getHotVideosFeed(){
	  steem.api.getState('hot/dtube', function(err, r) {
		var videos = [];
		for(var key in r.content){
			if (key.substring(key.indexOf("/")+1).length == 8){
				if (r.content[key].category == "dtube"){
					if (isVideoViewable(r.content[key])){
						videos.push(getSimpleVideoObject(r.content[key]));
					}
				}
			}
		}
		console.log("hot loaded");
		androidAppProxy.getHotVideosFeedCallback(JSON.stringify(videos));
		})
	  .catch(console.log);
}



//A callback function
//gets a set of videos and sends as a single chunk
function getTrendingVideosFeed(){
	 steem.api.getState('trending/dtube', function(err, r) {
		var videos = [];
		for(var key in r.content){
			if (key.substring(key.indexOf("/")+1).length == 8){
				if (r.content[key].category == "dtube"){
					if (isVideoViewable(r.content[key])){
						videos.push(getSimpleVideoObject(r.content[key]));
					}
				}
			}
		}
		console.log("trending loaded");
		androidAppProxy.getTrendingVideosFeedCallback(JSON.stringify(videos));
		})
	  .catch(console.log);
}



//A callback function
//gets a set of videos and sends as a single chunk
function getNewVideosFeed(){
	  steem.api.getState('created/dtube', function(err, r) {
				var videos = [];
				for(var key in r.content){
					if (key.substring(key.indexOf("/")+1).length == 8){
						if (r.content[key].category == "dtube"){
							if (isVideoViewable(r.content[key])){
								videos.push(getSimpleVideoObject(r.content[key]));
							}
						}
					}
				}
				console.log("new loaded");
				androidAppProxy.getNewVideosFeedCallback(JSON.stringify(videos));
		})
	  .catch(console.log);
}



//turns a video object from steemit API into something more workable
function getSimpleVideoObject(r){
	var metadata = JSON.parse(r.json_metadata);

	var video = new Object();
	video.username = r.author;
	video.title = r.title;

	var pendingValue = parseFloat(r.pending_payout_value.substring(0,r.pending_payout_value.indexOf(" ")));
	var payoutValue = parseFloat(r.total_payout_value.substring(0,r.total_payout_value.indexOf(" ")));
	var curatorValue = parseFloat(r.curator_payout_value.substring(0,r.curator_payout_value.indexOf(" ")));

	var totalPrice = pendingValue + payoutValue + curatorValue;
	totalPrice = totalPrice.toFixed(3);

	//video.price = r.pending_payout_value;
	//video.price = video.price.substring(0,video.price.indexOf(" "));
	video.price = "$" +totalPrice;

	video.permlink = r.permlink;
	video.date = r.created;

	if (metadata && metadata.video && metadata.video.content && metadata.video.info){
		video.snaphash = metadata.video.info.snaphash;
		video.hash = metadata.video.content.videohash;
	}
	return(video);
}



//turns a video object from steemit API into something more workable
function getAdvancedVideoObject(r, accountName){
	var metadata = JSON.parse(r.json_metadata);

	var video = new Object();
	video.username = r.author;
	video.title = r.title;

	var pendingValue = parseFloat(r.pending_payout_value.substring(0,r.pending_payout_value.indexOf(" ")));
	var payoutValue = parseFloat(r.total_payout_value.substring(0,r.total_payout_value.indexOf(" ")));
	var curatorValue = parseFloat(r.curator_payout_value.substring(0,r.curator_payout_value.indexOf(" ")));

	var totalPrice = pendingValue + payoutValue + curatorValue;
	totalPrice = totalPrice.toFixed(3);

	//video.price = r.pending_payout_value;
	//video.price = video.price.substring(0,video.price.indexOf(" "));
     video.price = "$" +totalPrice;

	video.permlink = r.permlink;
	video.date = r.created;


	try{
		var beginingIndex = r.body.lastIndexOf("<a href='")+9;
	    	var stream = r.body.substring(beginingIndex,r.body.indexOf("'>",beginingIndex));
		if (stream.includes("ipfs")){
			video.gateway = (stream.split("://")[1]);
			video.gateway = video.gateway.substring(0, video.gateway.indexOf("/"))
		}
	}catch(e){
		console.log(e);
	}

	if (metadata && metadata.video && metadata.video.content && metadata.video.info){
		video.snaphash = metadata.video.info.snaphash;
		video.hash = metadata.video.content.videohash;
		video.description = metadata.video.content.description;
	}
	//video.description = r.body;

	var likes = 0;
	var dislikes = 0;

	//0=no vote
     //1=vote up
     //-1=vote down
     var voteType = 0;

	var vote;
	for (voteIndex in r.active_votes) {
		vote =  r.active_votes[voteIndex];

		if (vote.percent>0)
			likes++;
		else if (vote.percent<0)
			dislikes++;

		if (vote.voter == accountName){
			if (vote.percent>0)
				voteType = 1;
			else if (vote.percent<0)
				voteType = -1;
		}

	}

	video.likes = likes;
	video.dislikes = dislikes;
	video.voteType = voteType;

	return(video);
}



//turnes a reply object from Steemit API into something more workable
function getCommentsObject(replies, indent){
	var commentsObject = [];

	for (i in replies){
		var commentObject = new Object();
		commentObject.permlink = replies[i].permlink;
		commentObject.parentPermlink = replies[i].parent_permlink;
		commentObject.comment = replies[i].body;
		commentObject.author = replies[i].author;
		commentObject.indent = indent
		commentObject.date = replies[i].created;

		var pendingValue = parseFloat(replies[i].pending_payout_value.substring(0,replies[i].pending_payout_value.indexOf(" ")));
		var payoutValue = parseFloat(replies[i].total_payout_value.substring(0,replies[i].total_payout_value.indexOf(" ")));
		var curatorValue = parseFloat(replies[i].curator_payout_value.substring(0,replies[i].curator_payout_value.indexOf(" ")));

		var totalPrice = pendingValue + payoutValue + curatorValue;
		totalPrice = totalPrice.toFixed(3);

		//video.price = r.pending_payout_value;
		//video.price = video.price.substring(0,video.price.indexOf(" "));
		commentObject.price = "$" +totalPrice;

		commentsObject.push(commentObject);
		if (replies[i].replies.length>0)
			commentsObject.push.apply(commentsObject, getCommentsObject(replies[i].replies, indent+1));
	}
	return commentsObject;
}

//detects if appropriate dtube video information exists and detects any NSFW
function isVideoViewable(r){
	var metadata = JSON.parse(r.json_metadata);
	if (metadata && metadata.video && metadata.video.content && metadata.video.info){
		if (!metadata.tags.includes("nsfw") && !metadata.tags.includes("dtube-NSFW") && !metadata.tags.includes("NSFW")){
			//blacklisted accounts with inappropriate content
			var BLACKLIST = ["aroused","godfather123","arabebtc","elibella"];
			if (!BLACKLIST.includes(r.author))
				return true;
		}
	}
	return false;
}