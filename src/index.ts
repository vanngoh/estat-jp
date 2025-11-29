import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

interface EstatResponse {
  GET_STATS_DATA: {
    RESULT: {
      STATUS: number;
      ERROR_MSG?: string;
      DATE: string;
    };
    PARAMETER: {
      LANG: string;
      STATS_DATA_ID: string;
      NARROWING_COND: {
        CODE_CAT01_SELECT: string;
        CODE_CAT02_SELECT: number;
        CODE_CAT03_SELECT: number;
      };
      DATA_FORMAT: string;
      METAGET_FLG: string;
      EXPLANATION_GET_FLG: string;
      ANNOTATION_GET_FLG: string;
      REPLACE_SP_CHARS: number;
      CNT_GET_FLG: string;
      SECTION_HEADER_FLG: number;
    };
    STATISTICAL_DATA: {
      CLASS_INF: {
        CLASS_OBJ: Array<{
          '@id': string;
          '@name': string;
          CLASS: Array<{
            '@code': string;
            '@name': string;
            '@level': string;
            '@parentCode'?: string;
          }> | {
            '@code': string;
            '@name': string;
            '@level': string;
            '@parentCode'?: string;
          };
        }>;
      };
      DATA_INF: {
        VALUE: Array<{
          '@time': string;
          '@cat01': string;
          '@cat02': string;
          '@cat03': string;
          '@unit': string;
          '$': string;
        }>;
      };
    };
  };
}

interface CleanedData {
  updatedAt: string;
  branches: {
    [branchCode: string]: {
      name: string;
      code: string;
      data: {
        [time: string]: {
          timeName: string;
          categories: {
            [cat01: string]: {
              value: string;
              unit: string;
              name: string;
            };
          };
        };
      };
    };
  };
}

const ESTAT_API_URL = 'http://api.e-stat.go.jp/rest/3.0/app/json/getStatsData';
const OUTPUT_DIR = './json';

function convertTimeKey(timeKey: string): string {
  // Convert from YYYY00MMDD format to YYYY-MM
  // Example: "2025000404" -> "2025-04"
  const year = timeKey.substring(0, 4);
  const month = timeKey.substring(6, 8);
  return `${year}-${month}`;
}

function cleanEstatData(rawData: EstatResponse): CleanedData {
  const updatedAt = rawData.GET_STATS_DATA.RESULT.DATE;
  const valueData = rawData.GET_STATS_DATA.STATISTICAL_DATA.DATA_INF.VALUE;
  const classInf = rawData.GET_STATS_DATA.STATISTICAL_DATA.CLASS_INF.CLASS_OBJ;
  
  // Create lookup maps for names
  const timeNameMap = new Map<string, string>();
  const cat01NameMap = new Map<string, string>();
  const cat03NameMap = new Map<string, string>();
  
  // Extract time, cat01, and cat03 names from CLASS_INF
  classInf.forEach(classObj => {
    if (classObj['@id'] === 'time') {
      const timeClasses = Array.isArray(classObj.CLASS) ? classObj.CLASS : [classObj.CLASS];
      timeClasses.forEach(timeClass => {
        timeNameMap.set(timeClass['@code'], timeClass['@name']);
      });
    } else if (classObj['@id'] === 'cat01') {
      const cat01Classes = Array.isArray(classObj.CLASS) ? classObj.CLASS : [classObj.CLASS];
      cat01Classes.forEach(cat01Class => {
        cat01NameMap.set(cat01Class['@code'], cat01Class['@name']);
      });
    } else if (classObj['@id'] === 'cat03') {
      const cat03Classes = Array.isArray(classObj.CLASS) ? classObj.CLASS : [classObj.CLASS];
      cat03Classes.forEach(cat03Class => {
        cat03NameMap.set(cat03Class['@code'], cat03Class['@name']);
      });
    }
  });
  
  const cleanedData: CleanedData = {
    updatedAt,
    branches: {}
  };

  // Group data by branch (@cat03), then by time, then by category (@cat01)
  valueData.forEach(item => {
    const originalTime = item['@time'];
    const time = convertTimeKey(originalTime); // Convert to YYYY-MM format
    const cat01 = item['@cat01'];
    const cat03 = item['@cat03'];
    const value = item['$'];
    const unit = item['@unit'];
    
    const timeName = timeNameMap.get(originalTime) || originalTime;
    const cat01Name = cat01NameMap.get(cat01) || cat01;
    const cat03Name = cat03NameMap.get(cat03) || cat03;

    // Initialize branch if not exists
    if (!cleanedData.branches[cat03]) {
      cleanedData.branches[cat03] = {
        name: cat03Name,
        code: cat03,
        data: {}
      };
    }

    // Initialize time period if not exists
    if (!cleanedData.branches[cat03].data[time]) {
      cleanedData.branches[cat03].data[time] = {
        timeName,
        categories: {}
      };
    }

    // Add category data
    cleanedData.branches[cat03].data[time].categories[cat01] = {
      value,
      unit,
      name: cat01Name
    };
  });

  return cleanedData;
}

function isDataDifferent(newData: CleanedData, existingData: CleanedData): boolean {
  // Compare only the branches field, ignoring updatedAt
  return JSON.stringify(newData.branches) !== JSON.stringify(existingData.branches);
}

async function fetchEstatPermanentResidenceData(): Promise<void> {
  try {
    console.log('🔄 Fetching data from eSTAT Japan API...');
    
    const params = {
      cdCat01: '100000,102000,103000,300000',
      cdCat02: 60,
      // cdCat03: 101170, // To fetch all branches, do not set this filter
      appId: process.env.ESTAT_APP_ID, // Read from GitHub Secret
      lang: 'J',
      statsDataId: '0003449073',
      metaGetFlg: 'Y',
      cntGetFlg: 'N',
      explanationGetFlg: 'Y',
      annotationGetFlg: 'Y',
      sectionHeaderFlg: 1,
      replaceSpChars: 0
    };

    const response = await axios.get<EstatResponse>(ESTAT_API_URL, { params });
    
    if (response.data.GET_STATS_DATA.RESULT.STATUS !== 0) {
      console.error(`❌ API Error: ${response.data.GET_STATS_DATA.RESULT.ERROR_MSG || 'Unknown error'}`);
      return;
    }

    // Clean up the data
    const cleanedData = cleanEstatData(response.data);

    // Create output directory if it doesn't exist
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    // Check if file exists and compare data
    const filepath = path.join(OUTPUT_DIR, 'whole-jp.json');
    let shouldUpdate = true;
    let existingData: CleanedData | null = null;

    if (fs.existsSync(filepath)) {
      try {
        const existingContent = fs.readFileSync(filepath, 'utf8');
        existingData = JSON.parse(existingContent);
        
        // Compare data content (ignoring updatedAt)
        if (existingData && !isDataDifferent(cleanedData, existingData)) {
          console.log('📊 Data content is identical, skipping update');
          console.log(`📅 Current updatedAt: ${existingData.updatedAt}`);
          console.log(`📅 New updatedAt: ${cleanedData.updatedAt}`);
          shouldUpdate = false;
        } else {
          console.log('📊 Data content has changed, updating file');
        }
      } catch (error) {
        console.warn('⚠️ Error reading existing file, will create new one:', error);
      }
    }

    if (shouldUpdate) {
      // Save the cleaned data to pr.json
      fs.writeFileSync(filepath, JSON.stringify(cleanedData, null, 2));
      
      console.log(`✅ Data successfully saved to: ${filepath}`);
      console.log(`📊 API Response Status: ${response.data.GET_STATS_DATA.RESULT.STATUS}`);
      console.log(`📅 Data Date: ${cleanedData.updatedAt}`);
      console.log(`🏢 Branches: ${Object.keys(cleanedData.branches).length}`);
      
      const firstBranch = cleanedData.branches[Object.keys(cleanedData.branches)[0]];
      if (firstBranch) {
        console.log(`📈 Time periods: ${Object.keys(firstBranch.data).length}`);
        console.log(`📋 Categories: ${Object.keys(firstBranch.data[Object.keys(firstBranch.data)[0]]?.categories || {}).length} per period`);
      }
    }
    
  } catch (error) {
    console.error('❌ Error fetching data:', error);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  fetchEstatPermanentResidenceData();
}

export { fetchEstatPermanentResidenceData, cleanEstatData, isDataDifferent }; 