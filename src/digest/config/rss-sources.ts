import { RssSource } from '../types/digest.types';

// Python daily-news-digest-be RSS 소스를 기반으로 운영 튜닝을 반영한 구성.
export const RSS_SOURCES: RssSource[] = [
  {
    topic: 'IT',
    url: 'https://news.google.com/rss/search?q=AI+반도체+OR+데이터센터+OR+클라우드+OR+보안+취약점+OR+AI+규제+-리포트+-세미나+-웨비나+-칼럼&hl=ko&gl=KR&ceid=KR:ko',
    limit: 12,
  },
  {
    topic: 'IT',
    url: 'https://news.google.com/rss/search?q=AI+chips+OR+data+center+OR+cloud+infrastructure+OR+cybersecurity+vulnerability+OR+AI+regulation+-opinion+-column+-webinar+-whitepaper&hl=en&gl=US&ceid=US:en',
    limit: 12,
  },
  {
    topic: '경제',
    url: 'https://news.google.com/rss/search?q=금리+OR+환율+OR+물가+OR+고용+OR+실적+OR+경기+전망+OR+정부+정책+OR+에너지전환+OR+태양광+OR+바이오+헬스케어+-리포트+-세미나+-칼럼&hl=ko&gl=KR&ceid=KR:ko',
    limit: 15,
  },
  {
    topic: '경제',
    url: 'https://news.google.com/rss/search?q=interest+rate+OR+inflation+OR+fx+OR+jobs+report+OR+earnings+OR+economic+policy+OR+energy+transition+OR+biotech+OR+healthcare+-opinion+-column+-webinar+-whitepaper&hl=en&gl=US&ceid=US:en',
    limit: 15,
  },
  {
    topic: '글로벌_정세',
    url: 'https://news.google.com/rss/search?q=관세+OR+제재+OR+무역+OR+공급망+OR+외교+OR+국제+협상+-사망+-살인+-폭행+-연예+-스포츠+-리포트+-칼럼&hl=ko&gl=KR&ceid=KR:ko',
    limit: 12,
  },
  {
    topic: '글로벌_정세',
    url: 'https://news.google.com/rss/search?q=tariff+OR+sanctions+OR+trade+OR+supply+chain+OR+diplomacy+OR+geopolitics+-opinion+-column+-sports+-celebrity+-webinar+-whitepaper&hl=en&gl=US&ceid=US:en',
    limit: 12,
  },
  {
    topic: '글로벌_빅테크',
    url: 'https://news.google.com/rss/search?q=Apple+OR+Microsoft+OR+Google+OR+OpenAI+OR+NVIDIA+OR+Amazon+OR+Meta+OR+Tesla+OR+TSMC+-opinion+-column+-webinar+-whitepaper&hl=en&gl=US&ceid=US:en',
    limit: 10,
  },
  {
    topic: '글로벌_빅테크',
    url: 'https://news.google.com/rss/search?q=애플+OR+마이크로소프트+OR+구글+OR+오픈AI+OR+엔비디아+OR+아마존+OR+메타+OR+TSMC+-리포트+-세미나+-칼럼&hl=ko&gl=KR&ceid=KR:ko',
    limit: 8,
  },
  {
    topic: '실적_가이던스',
    url: 'https://news.google.com/rss/search?q=실적+OR+가이던스+OR+전망+OR+매출+OR+영업이익+OR+컨센서스+-칼럼+-리포트+-세미나&hl=ko&gl=KR&ceid=KR:ko',
    limit: 12,
  },
  {
    topic: '실적_가이던스',
    url: 'https://news.google.com/rss/search?q=earnings+OR+guidance+OR+forecast+OR+quarterly+results+OR+revenue+OR+margin+-opinion+-column+-webinar&hl=en&gl=US&ceid=US:en',
    limit: 12,
  },
  {
    topic: '반도체_공급망',
    url: 'https://news.google.com/rss/search?q=HBM+OR+첨단패키징+OR+파운드리+OR+EUV+OR+반도체장비+OR+수출통제+-칼럼+-리포트+-세미나&hl=ko&gl=KR&ceid=KR:ko',
    limit: 12,
  },
  {
    topic: '반도체_공급망',
    url: 'https://news.google.com/rss/search?q=HBM+OR+advanced+packaging+OR+foundry+OR+EUV+OR+semiconductor+equipment+OR+export+controls+-opinion+-column+-webinar&hl=en&gl=US&ceid=US:en',
    limit: 12,
  },
  {
    topic: '전력_인프라',
    url: 'https://news.google.com/rss/search?q=전력망+OR+송전+OR+변전소+OR+전기요금+OR+원전+OR+LNG+OR+전력수급+-칼럼+-리포트+-연예+-스포츠&hl=ko&gl=KR&ceid=KR:ko',
    limit: 12,
  },
  {
    topic: '전력_인프라',
    url: 'https://news.google.com/rss/search?q=power+grid+OR+electricity+prices+OR+utility+OR+nuclear+OR+natural+gas+OR+transmission+OR+substation+OR+data+center+power+-opinion+-column+-webinar&hl=en&gl=US&ceid=US:en',
    limit: 12,
  },
  {
    topic: 'AI_저작권_데이터권리',
    url: 'https://news.google.com/rss/search?q=AI+저작권+OR+학습데이터+OR+라이선스+OR+개인정보+OR+데이터보호+-칼럼+-리포트+-세미나&hl=ko&gl=KR&ceid=KR:ko',
    limit: 10,
  },
  {
    topic: 'AI_저작권_데이터권리',
    url: 'https://news.google.com/rss/search?q=AI+copyright+OR+training+data+OR+licensing+OR+privacy+OR+data+protection+-opinion+-column+-webinar&hl=en&gl=US&ceid=US:en',
    limit: 10,
  },
  {
    topic: '보안_취약점_패치',
    url: 'https://news.google.com/rss/search?q=취약점+OR+CVE+OR+제로데이+OR+보안패치+OR+권고+OR+침해사고+-칼럼+-연예+-스포츠&hl=ko&gl=KR&ceid=KR:ko',
    limit: 10,
  },
  {
    topic: '보안_취약점_패치',
    url: 'https://news.google.com/rss/search?q=zero-day+OR+patch+OR+CVE+OR+ransomware+OR+breach+notification+OR+incident+response+-opinion+-column+-webinar&hl=en&gl=US&ceid=US:en',
    limit: 10,
  },
  {
    topic: '투자_MA_IPO',
    url: 'https://news.google.com/rss/search?q=IPO+OR+상장+OR+인수합병+OR+투자유치+OR+시리즈A+OR+벤처캐피탈+-칼럼+-연예+-스포츠&hl=ko&gl=KR&ceid=KR:ko',
    limit: 10,
  },
  {
    topic: '투자_MA_IPO',
    url: 'https://news.google.com/rss/search?q=IPO+OR+acquisition+OR+merger+OR+funding+round+OR+venture+capital+-opinion+-column+-webinar&hl=en&gl=US&ceid=US:en',
    limit: 10,
  },
  {
    topic: '국내_정책_규제',
    url: 'https://news.google.com/rss/search?q=국회+OR+입법+OR+시행령+OR+가이드라인+OR+금융위원회+OR+공정거래위원회+OR+개인정보보호위원회+OR+과학기술정보통신부+-연예+-스포츠+-칼럼&hl=ko&gl=KR&ceid=KR:ko',
    limit: 15,
  },
  {
    topic: '국내_산업_공급망',
    url: 'https://news.google.com/rss/search?q=산업통상자원부+OR+중소벤처기업부+OR+국가첨단전략산업+OR+공급망+안정화+OR+수출+통관+OR+생산+투자+-연예+-스포츠+-칼럼+-리포트&hl=ko&gl=KR&ceid=KR:ko',
    limit: 15,
  },
  {
    topic: '국내_금융_통화정책',
    url: 'https://news.google.com/rss/search?q=한국은행+OR+금통위+OR+기준금리+OR+금융위원회+OR+금융감독원+OR+가계부채+OR+회사채+OR+환율+안정+-연예+-스포츠+-칼럼+-리포트&hl=ko&gl=KR&ceid=KR:ko',
    limit: 15,
  },
  {
    topic: '국내_고용_내수',
    url: 'https://news.google.com/rss/search?q=고용+지표+OR+실업률+OR+내수+OR+소매판매+OR+소비심리+OR+물가+안정+OR+공공요금+OR+민생대책+-연예+-스포츠+-칼럼+-리포트&hl=ko&gl=KR&ceid=KR:ko',
    limit: 12,
  },
];
