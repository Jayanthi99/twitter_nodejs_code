const express = require('express')
const app = express()

app.use(express.json())

const {open} = require('sqlite')
const sqlite3 = require('sqlite3')

const path = require('path')
const dbPath = path.join(__dirname, 'twitterClone.db')
let db = null

const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')

const connection = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    })
    app.listen(3000, () => {
      console.log('Server is Running......')
    })
  } catch (e) {
    console.log(`Error is ${e.message}`)
    process.exit(1)
  }
}

connection()

const authentication = async (request, response, next) => {
  let jwtToken
  const requestHeaders = request.headers['authorization']

  if (requestHeaders !== undefined) {
    jwtToken = requestHeaders.split(' ')[1]
  }
  if (jwtToken === undefined) {
    response.status(401)
    response.send('Invalid JWT Token')
  } else {
    jwt.verify(jwtToken, 'Secret_key_Token', async (error, payload) => {
      if (error) {
        response.status(401)
        response.send('Invalid JWT Token')
      } else {
        request.username = payload.username
        const userIdQuery = `
        SELECT user_id FROM user
        WHERE username = "${payload.username}"
  `
        const userIdResponse = await db.get(userIdQuery)
        const userId = userIdResponse.user_id
        request.userId = userId
        next()
      }
    })
  }
}

app.post('/register/', async (request, response) => {
  const {username, password, name, gender} = request.body

  const userQuery = `
        SELECT * FROM user 
        WHERE username = "${username}";
    `

  const userQueryResponse = await db.get(userQuery)
  if (userQueryResponse === undefined) {
    if (password.length < 6) {
      response.status(400)
      response.send('Password is too short')
    } else {
      const hashedPassword = await bcrypt.hash(request.body.password, 12)
      const insertUserQuery = `
            INSERT INTO user(username, password, name, gender) 
            VALUES ("${username}", "${hashedPassword}", "${name}", "${gender}")
            `
      await db.run(insertUserQuery)

      response.send('User created successfully')
    }
  } else {
    response.status(400)
    response.send('User already exists')
  }
})

app.post('/login/', async (request, response) => {
  const {username, password} = request.body

  const userQuery = `
        SELECT * FROM user 
        WHERE username = "${username}";
    `
  const userQueryResponse = await db.get(userQuery)

  if (userQueryResponse !== undefined) {
    const passwordCheck = await bcrypt.compare(
      password,
      userQueryResponse.password,
    )
    if (passwordCheck) {
      const payload = {
        username,
        userId: userQueryResponse.user_id,
      }
      const jwtToken = jwt.sign(payload, 'Secret_key_Token')
      response.send({jwtToken})
    } else {
      response.status(400)
      response.send('Invalid password')
    }
  } else {
    response.status(400)
    response.send('Invalid user')
  }
})

const getfollowersIds = async username => {
  const followerIdsQuery = `
    SELECT following_user_id	FROM follower INNER JOIN user ON 
    user.user_id =  follower.follower_user_id
    WHERE username = "${username}";
  `
  const peopleIds = await db.all(followerIdsQuery)
  const arrayPeopleIds = peopleIds.map(eachId => eachId.following_user_id)

  return arrayPeopleIds
}

app.get('/user/tweets/feed/', authentication, async (request, response) => {
  const {username} = request
  const followingIds = await getfollowersIds(username)

  const tweetPeopleQuery = `
    SELECT username, tweet, date_time as dateTime 
    FROM tweet INNER JOIN user ON
    user.user_id = tweet.user_id
    WHERE user.user_id IN (${followingIds})
    ORDER BY date_time DESC
    LIMIT 4;
  `

  const tweets = await db.all(tweetPeopleQuery)
  response.send(tweets)
})

app.get('/user/following/', authentication, async (request, response) => {
  const {username} = request

  const userIdQuery = `
        SELECT user_id FROM user
        WHERE username = "${username}"
  `
  const userIdResponse = await db.get(userIdQuery)
  const userId = userIdResponse.user_id

  const userFollowsQuery = `
    SELECT name from follower INNER JOIN user ON 
    user.user_id = follower.following_user_id
    WHERE follower_user_id = ${userId}
  `
  const userFollowsQueryResponse = await db.all(userFollowsQuery)
  response.send(userFollowsQueryResponse)
})

app.get('/user/followers/', authentication, async (request, response) => {
  const {username, userId} = request

  const userFollowersQuery = `
      SELECT name FROM follower INNER JOIN user
      ON user.user_id = follower.follower_user_id
      WHERE following_user_id = ${userId}
  `
  const userFollowsQueryResponse = await db.all(userFollowersQuery)
  response.send(userFollowsQueryResponse)
})

const tweetAuthentication = async (request, response, next) => {
  const {userId} = request
  const {tweetId} = request.params

  const tweetdetailsQuery = `
      SELECT * FROM tweet INNER JOIN follower 
      ON tweet.user_id = follower.following_user_id
      WHERE follower_user_id = ${tweetId}
   `
  const tweet = await db.get(tweetdetailsQuery)

  if (tweet === undefined) {
    response.status(401)
    response.send('Invalid Request')
  } else {
    next()
  }
}

app.get(
  '/tweets/:tweetId/',
  authentication,
  tweetAuthentication,
  async (request, response) => {
    const {username, userId} = request
    const {tweetId} = request.params

    const tweetQuery = `
    SELECT tweet,
    (SELECT COUNT() FROM like WHERE tweet_id = ${tweetId}) as likes,
    (SELECT COUNT() FROM reply WHERE tweet_id = ${tweetId}) as replies,
    date_time as dateTime
    FROM tweet
    WHERE tweet.tweet_id = ${tweetId};
  `
    const tweetQueryResponse = await db.get(tweetQuery)
    response.send(tweetQueryResponse)
  },
)

app.get(
  '/tweets/:tweetId/likes/',
  authentication,
  tweetAuthentication,
  async (request, response) => {
    const {tweetId} = request.params

    const likeQuery = `
    SELECT username FROM user INNER JOIN like ON 
    user.user_id = like.user_id
    WHERE tweet_id = ${tweetId}
  `
    const likeQueryResponse = await db.all(likeQuery)
    const userLikes = likeQueryResponse.map(each => each.username)
    response.send({likes: userLikes})
  },
)

app.get(
  '/tweets/:tweetId/replies/',
  authentication,
  tweetAuthentication,
  async (request, response) => {
    const {tweetId} = request.params

    const replyQuery = `
    SELECT name, reply FROM user INNER JOIN reply ON 
    user.user_id = reply.user_id
    WHERE tweet_id = ${tweetId}
  `
    const replyQueryResponse = await db.all(replyQuery)
    response.send({replies: replyQueryResponse})
  },
)

app.get('/user/tweets/', authentication, async (request, response) => {
  const {userId} = request

  const getTweetQuery = `
    SELECT tweet, 
    COUNT(DISTINCT like_id) as likes,
    COUNT(DISTINCT reply_id) as replies,
    date_time as dateTime FROM 
    tweet LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id LEFT JOIN like ON tweet.tweet_id = like.tweet_id
    WHERE tweet.user_id = ${userId}
    GROUP BY tweet.tweet_id;
  `
  const userTweetDetails = await db.all(getTweetQuery)
  response.send(userTweetDetails)
})

app.post('/user/tweets/', authentication, async (request, response) => {
  const {tweet} = request.body
  const {userId} = parseInt(request.userId)
  const dateTime = new Date().toJSON().substring(0, 19).replace('T', ' ')

  const createTweet = `
    INSERT INTO tweet(tweet, user_id, date_time)
    VALUES("${tweet}", "${userId}", "${dateTime}")
  `
  await db.run(createTweet)
  response.send('Created a Tweet')
})

app.delete('/tweets/:tweetId/', authentication, async (request, response) => {
  const {userId} = request
  const {tweetId} = request.params

  const getQuery = `SELECT * FROM tweet WHERE user_id = ${userId} AND tweet_id = ${tweetId}`
  const getResponse = await db.get(getQuery)
  if (getResponse === undefined) {
    response.status(401)
    response.send('Invalid Request')
  } else {
    const deleteTweetQuery = `
      DELETE FROM tweet WHERE tweet_id = ${tweetId}
    `
    await db.run(deleteTweetQuery)
    response.send('Tweet Removed')
  }
})

module.exports = app
