import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';

import { LoginPage } from './login';
import { LoginPageRoutingModule } from './login-routing.module';

@NgModule({
  // 导出本模块中的组件模板所需的类其他的模块
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    LoginPageRoutingModule
  ],
  //属于本模块的组件
  declarations: [
    LoginPage,
  ]
})
export class LoginModule { }
