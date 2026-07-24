# HAQ Lab PBL Site
Nós estamos apoiar programas em regiões diferentes com múltiplas línguas em nossa interface de usuário & primária documentação. Selecione um dos idiomas disponíveis para este README abaixo:
<br>
[![en](https://img.shields.io/badge/lang-en-red.svg)](https://github.com/HanniganAirQuality/PBLinRuralSchools/tree/main/README.md)
[![pt-br](https://img.shields.io/badge/lang-pt--br-green.svg)](https://github.com/HanniganAirQuality/PBLinRuralSchools/tree/main/README.pt-BR.md)
<br>

Tradução para o Português por Percy Smith em 24/07/2026 (peço desculpa, ainda estou a aprender português)
<br> **Aviso: as novas atualizações serão menos frequentes, pois a língua principal de desenvolvimento é o inglês**

Site estático  para nosso programa aprendizagem baseada em projetos (EN: 'HAQ Lab PBL' program), administrado em 'GitHub Pages'.
[https://hanniganairquality.github.io/PBLinRuralSchools/](https://hanniganairquality.github.io/PBLinRuralSchools/)

## Estrutura
```text
pbl.haq-lab.github.io/
|-- index.html                  Site Índice 
|-- aqiq/
|   |-- index.html              Centro site: **Pergunte Ao Ar** (EN: 'Air Quality InQuiry (AQIQ)')
|   `-- tools/
|       |-- data-plotter/
|       |   `-- index.html      Plotadora estática
|       `-- live-viewer/
|           `-- index.html      Visualização ao vivo (YPOD)
|-- fire-iq/
|   |-- index.html              Centro site: **Pergunte Ao Fogo** (EN: 'Fire InQuiry (Fire-IQ)')
|   `-- tools/
|       |-- data-plotter/
|       |   `-- index.html      Plotadora estática 
|       `-- live-viewer/
|           `-- index.html      Visualização ao vivo dupla (2x Fire YPOD)
|-- sqiq/
|   |-- index.html              Centro site: **Pergunte Ao Solo** (EN: 'Soil Quality InQuiry (SQIQ)')
|   `-- tools/
|       `-- live-viewer/
|           `-- index.html      Visualização ao vivo (SPOD)
|-- water-iq/
|   `-- index.html              *Em construção: Pergunte Ao Água (EN: 'Water Quality InQuiry (WQIQ)')*
|-- assets/
|   |-- css/
|   |-- generated/
|   |-- js/
|   |   |-- core/
|   |   `-- viewers/
|   `-- vendor/
|-- .github/
|   `-- workflows/
`-- .nojekyll
```

## Detalhes do Programa

| Programa  | Instrumento   | Estado        | Ferramentas                                           |
| ---       | ---           | ---           | ---                                                   |
| AQIQ      | YPOD          | Ativa        | Visualização ao vivo, Plotadora estática              |
| Fire-IQ   | YPOD mod      | Ativa        | Visualização ao vivo, Plotadora estática                             |
| SQIQ      | SPOD          | Ativa        | Visualização ao vivo, Plotadora estática                                           |
| WQIQ      | TBD           | Em construção |                                           |

## Live Viewer

Visualização ao vivo de Pergunte Ao Ar (EN: 'Air Quality InQuiry (AQIQ)') é uma aplicação de Web estática que utiliza Portas Seriais para apresentar os dados de um monitor de qualidade do ar (YPOD). Por padrão, utiliza taxa de bauds de 9600, carrega a última entrada de `YPOD_*` em `YPOD_HeaderLog.yaml` no `HanniganAirQuality/All-POD-YAMLs` repositório, e analisa os CSV inserções nesse formato. Linhas com entrada de `Firmware_Version` passarão para a versão automaticamente; linhas antigas sem metadados de versão mantêm a versão selecionada pelo usuário. As novas versões do YAML dão preferência a `Calibrated`; as versões antigas recorrem a `Serial_Calibrate` ou `Serial`. As configurações avançadas permitem selecionar a versão do YAML, seção de dados, janela de tempo, e gráficos visíveis.

Visualização ao vivo de Pergunte Ao Fogo (EN: 'Fire InQuiry (Fire-IQ)') é uma aplicação de Web estática que utiliza Portas Seriais para apresentar dados em dois monitores de qualidade do ar (YPOD, modificado). Ela utiliza o `YPOD_HeaderLog.yaml` e idêntico mapeamento da versão do firmware, com a diferença de que utiliza dois monitores e exibe os valores de CO, CO₂ e PM2,5. 

Visualização ao vivo de Pergunte Ao Solo (EN: 'Soil Quality InQuiry (SQIQ)') é uma aplicação de Web estática que utiliza Portas Seriais para apresentar os dados de um monitor de qualidade do solo. Ela utiliza o `SPOD_HeaderLog.yaml` e é compatível tanto com a versão 1,0 como com a versão 2,0. A aplicação apresenta gráficos da temperatura, do CO₂, da humidade do solo e da luz visível, infravermelha e ultravioleta. 

## Hospedagem 

Administrado em 'GitHub Pages'. Requer HTTPS para 'API Web Serial', que é fornecida automaticamente no `*.github.io`.

## HAQ Lab, Universidade do Colorado 
