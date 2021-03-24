import { HttpClientModule } from '@angular/common/http';
import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { InAppBrowser } from '@ionic-native/in-app-browser/ngx';
import { SplashScreen } from '@ionic-native/splash-screen/ngx';
import { StatusBar } from '@ionic-native/status-bar/ngx';
import { IonicModule } from '@ionic/angular';
import { IonicStorageModule } from '@ionic/storage';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { ServiceWorkerModule } from '@angular/service-worker';
import { environment } from '../environments/environment';
import { FormsModule } from '@angular/forms';
import { MemberComponent } from './member/member.component';
import { ChatComponent } from './chat/chat.component';
import { MainvideoComponent } from './board/mainvideo/mainvideo.component';
import { DocumentComponent } from './board/document/document.component';
import { WhiteboardComponent } from './board/whiteboard/whiteboard.component';
import { SharedeskComponent } from './board/sharedesk/sharedesk.component';
import { SharemediaComponent } from './board/sharemedia/sharemedia.component';
import { MoreComponent } from './popover/more/more.component';
import { SettingComponent } from './popover/setting/setting.component';
import { NetstatComponent } from './popover/netstat/netstat.component';
import { SharepopoverComponent } from './popover/sharepopover/sharepopover.component';
import { VideoplayerComponent } from './videoplayer/videoplayer.component';
import { EmojiComponent } from './popover/emoji/emoji.component';
import { MainComponent } from './main/main.component';
import { DocselectComponent } from './popover/docselect/docselect.component';
import { DrawtoolComponent } from './drawtool/drawtool.component';
import { PencilComponent } from './popover/pencil/pencil.component';
import { PagetoolComponent } from './pagetool/pagetool.component';
import { ThumbnailComponent } from './thumbnail/thumbnail.component';
import { InformationComponent } from './popover/information/information.component';

@NgModule({
  imports: [
    BrowserModule,
    AppRoutingModule,
    HttpClientModule,
    FormsModule,
    IonicModule.forRoot(),
    IonicStorageModule.forRoot(),
    ServiceWorkerModule.register('ngsw-worker.js', {
      enabled: environment.production
    })
  ],
  declarations: [
    AppComponent,
    MainComponent,
    MemberComponent,
    ChatComponent,

    MainvideoComponent,
    DocumentComponent,
    WhiteboardComponent,
    SharedeskComponent,
    SharemediaComponent,
    ThumbnailComponent,

    MoreComponent,
    SettingComponent,
    NetstatComponent,
    SharepopoverComponent,
    EmojiComponent,
    DocselectComponent,
    PencilComponent,
    InformationComponent,

    VideoplayerComponent,
    DrawtoolComponent,
    PagetoolComponent,
  ],
  entryComponents: [
    MoreComponent,
    SettingComponent,
    NetstatComponent,
    SharepopoverComponent,
    EmojiComponent,
    DocselectComponent,
    PencilComponent,
    InformationComponent,
  ],
  providers: [InAppBrowser, SplashScreen, StatusBar],
  bootstrap: [AppComponent]
})
export class AppModule {}
