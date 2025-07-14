# eSTAT Japan
This server will run daily to fetch the latest data from estat JP server and update the file.

## Preparation
Get an `appId` from [eSTAT Japan](https://www.e-stat.go.jp/mypage/view/api)
   - Register for an account on the eSTAT portal
   - After logging in, go to the API section to generate your `appId`
   - The `appId` will be required to make API calls
   - Keep the `appId` in GitHub Secret of this repo

## How it works
1. GitHub Actions workflow runs daily to trigger the data fetch
2. The workflow executes `npm run fetch` which:
   - Calls the eSTAT Japan API to get permanent residence application statistics
   - Cleans and transforms the raw API response data
   - Saves the cleaned data to `json/pr.json`
3. The updated data includes:
   - Total applications received (受理_総数)
   - Previously received applications (受理_旧受) 
   - Newly received applications (受理_新受)
   - Total processed applications (既済_総数)
4. Data is specifically for the Tokyo Regional Immigration Services Bureau
   - All statistics represent applications processed at the Tokyo office only
   - Does not include data from other regional immigration offices
